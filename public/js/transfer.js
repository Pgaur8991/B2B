let selectedFiles = [];
let currentIncomingFile = null;
let incomingFileWriter = null;
let incomingDirectoryHandle = null;
let incomingOpfsFileHandle = null;
let incomingSaveMode = "none";
let incomingFallbackChunks = [];
let incomingBatchId = null;
let incomingBatchTotal = 1;
let incomingBatchAccepted = false;
let transferStartTime = 0;
let bytesTransferred = 0;
let incomingMessageQueue = Promise.resolve();
let lastToastMessage = "";
let lastToastTime = 0;

window.currentOutgoingFile = null;
window.outgoingFileQueue = [];
window.outgoingTransferBusy = false;
window.outgoingTransferToken = 0;
window.outgoingBatchId = null;

const fileInput = document.getElementById("file-input");
const sendFileButton = document.getElementById("send-file-btn");
const selectedFilesContainer = document.getElementById("selected-files");
const cancelTransferButton = document.getElementById("cancel-transfer-btn");
const incomingFileSection = document.getElementById("incoming-file-section");
const incomingFileName = document.getElementById("incoming-file-name");
const incomingFileSize = document.getElementById("incoming-file-size");
const acceptFileButton = document.getElementById("accept-file-btn");
const transferProgressSection = document.getElementById("transfer-progress-section");
const progressBar = document.getElementById("progress-bar");
const progressText = document.getElementById("progress-text");
const transferSpeed = document.getElementById("transfer-speed");
const transferStatus = document.getElementById("transfer-status");
const transferTitle = document.getElementById("transfer-title");

// crypto.randomUUID() is not available in every browser/context, especially
// on LAN HTTP pages. B2B must still work there, so use safe fallbacks.
function createTransferId() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();

    if (globalThis.crypto?.getRandomValues) {
        const bytes = new Uint8Array(16);
        globalThis.crypto.getRandomValues(bytes);
        bytes[6] = (bytes[6] & 0x0f) | 0x40;
        bytes[8] = (bytes[8] & 0x3f) | 0x80;
        const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
        return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }

    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

if (fileInput) {
    fileInput.addEventListener("change", () => {
        selectedFiles = Array.from(fileInput.files || []);
        renderSelectedFiles();
        if (selectedFiles.length && !window.outgoingTransferBusy) {
            setTransferStatus("idle", `${selectedFiles.length} file${selectedFiles.length > 1 ? "s" : ""} selected. Ready to send.`);
        }
    });
}

function renderSelectedFiles() {
    if (!selectedFilesContainer) return;
    selectedFilesContainer.innerHTML = "";

    selectedFiles.forEach((file, index) => {
        const item = document.createElement("div");
        item.className = "file-list-item";

        const icon = document.createElement("span");
        icon.className = "file-list-icon";
        icon.textContent = "📄";

        const info = document.createElement("div");
        info.className = "file-list-info";

        const name = document.createElement("div");
        name.className = "file-list-name";
        name.title = file.name;
        name.textContent = file.name;

        const size = document.createElement("div");
        size.className = "file-list-size";
        size.textContent = formatBytes(file.size);

        info.append(name, size);

        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "file-remove-btn";
        remove.textContent = "×";
        remove.title = `Remove ${file.name}`;
        remove.disabled = window.outgoingTransferBusy;
        remove.addEventListener("click", () => removeSelectedFile(index));

        item.append(icon, info, remove);
        selectedFilesContainer.appendChild(item);
    });
}

function removeSelectedFile(index) {
    if (window.outgoingTransferBusy) return;
    selectedFiles.splice(index, 1);

    try {
        const dt = new DataTransfer();
        selectedFiles.forEach((file) => dt.items.add(file));
        fileInput.files = dt.files;
    } catch {}

    renderSelectedFiles();
}
window.renderSelectedFiles = renderSelectedFiles;

if (sendFileButton) {
    sendFileButton.addEventListener("click", async () => {
        if (!selectedFiles.length) {
            setTransferStatus("warning", "Please select at least one file first.");
            return;
        }
        if (!isDataChannelOpen()) {
            setTransferStatus("warning", "P2P connection is not ready.");
            return;
        }
        if (window.outgoingTransferBusy) {
            setTransferStatus("warning", "A file transfer is already in progress.");
            return;
        }

        window.outgoingTransferToken += 1;
        window.outgoingBatchId = createTransferId();
        window.outgoingFileQueue = [...selectedFiles];
        window.outgoingTransferBusy = true;
        updateTransferControls();

        try {
            await sendNextQueuedFile();
        } catch (error) {
            console.error("Could not start outgoing transfer:", error);
            stopOutgoingTransfer(error?.message || "Could not start the file transfer.", false);
        }
    });
}

async function sendNextQueuedFile() {
    if (!window.outgoingTransferBusy) return;
    if (!window.outgoingFileQueue.length) return finishOutgoingTransfer();
    if (!isDataChannelOpen()) return stopOutgoingTransfer("Peer disconnected before the next file could start.", true);

    const file = window.outgoingFileQueue.shift();
    if (!file || typeof file.slice !== "function") {
        return stopOutgoingTransfer("The selected file is no longer available.", false);
    }

    const transferId = createTransferId();
    const batchIndex = selectedFiles.length - window.outgoingFileQueue.length - 1;

    window.currentOutgoingFile = {
        file,
        transferId,
        batchId: window.outgoingBatchId,
        batchIndex
    };

    const offer = {
        type: "FILE_OFFER",
        transferId,
        batchId: window.outgoingBatchId,
        batchIndex,
        batchTotal: selectedFiles.length,
        name: file.name,
        size: file.size,
        mimeType: file.type || "application/octet-stream"
    };

    try {
        dataChannel.send(JSON.stringify(offer));
        console.log("Sending file offer:", offer);
        showTransferProgress(`Waiting for receiver: ${file.name}`);
        setTransferStatus("idle", `Waiting for the receiver to accept ${file.name}...`);
        updateTransferControls();
    } catch (error) {
        stopOutgoingTransfer(error?.message || "Could not send the file offer.", false);
    }
}

if (acceptFileButton) {
    acceptFileButton.addEventListener("click", async () => {
        if (!currentIncomingFile || incomingFileWriter) return;

        try {
            await acceptIncomingBatch();
        } catch (error) {
            if (error?.name === "AbortError") {
                incomingBatchAccepted = false;
                setTransferStatus("warning", "Save cancelled. The files were not accepted.");
            } else {
                console.error("Could not prepare incoming files:", error);
                incomingBatchAccepted = false;
                setTransferStatus("error", error?.message || "Could not prepare the destination.");
            }
            updateTransferControls();
        }
    });
}

async function acceptIncomingBatch() {
    if (!currentIncomingFile) return;

    incomingBatchId = currentIncomingFile.batchId || currentIncomingFile.transferId;
    incomingBatchTotal = currentIncomingFile.batchTotal || 1;
    incomingDirectoryHandle = null;
    incomingOpfsFileHandle = null;
    incomingSaveMode = "memory";
    incomingBatchAccepted = false;

    const secure = Boolean(window.isSecureContext);

    // Multi-file transfer: one user action must be enough. Prefer a directory,
    // then OPFS, then memory/download fallback. Never ask the user once per file.
    if (incomingBatchTotal > 1) {
        if (secure && "showDirectoryPicker" in window) {
            incomingDirectoryHandle = await window.showDirectoryPicker({ mode: "readwrite" });
            incomingSaveMode = "directory";
        } else if (secure && navigator.storage?.getDirectory) {
            incomingSaveMode = "opfs";
        } else {
            incomingSaveMode = "memory";
        }
    } else {
        // Single file: use a normal save picker when supported, otherwise use
        // a browser-download fallback that works on mobile/LAN HTTP pages.
        if (secure && "showSaveFilePicker" in window) {
            incomingSaveMode = "picker";
        } else if (secure && navigator.storage?.getDirectory) {
            incomingSaveMode = "opfs";
        } else {
            incomingSaveMode = "memory";
        }
    }

    incomingBatchAccepted = true;

    if (incomingSaveMode === "memory") {
        setTransferStatus("idle", "Accepted. The browser will prepare a download when the file finishes.");
    } else if (incomingSaveMode === "opfs") {
        setTransferStatus("idle", "Accepted. Receiving the file now...");
    }

    await prepareCurrentIncomingFile();
}

async function prepareCurrentIncomingFile() {
    if (!currentIncomingFile || incomingFileWriter) return;

    incomingFallbackChunks = [];
    incomingOpfsFileHandle = null;

    if (incomingSaveMode === "directory" && incomingDirectoryHandle) {
        const safeName = sanitizeFileName(currentIncomingFile.name);
        const fileHandle = await incomingDirectoryHandle.getFileHandle(safeName, { create: true });
        incomingFileWriter = await fileHandle.createWritable();
    } else if (incomingSaveMode === "picker") {
        const fileHandle = await window.showSaveFilePicker({ suggestedName: currentIncomingFile.name });
        incomingFileWriter = await fileHandle.createWritable();
    } else if (incomingSaveMode === "opfs" && navigator.storage?.getDirectory) {
        const root = await navigator.storage.getDirectory();
        const b2bDir = await root.getDirectoryHandle("b2b-transfers", { create: true });
        const batchDir = await b2bDir.getDirectoryHandle(incomingBatchId, { create: true });
        const safeName = sanitizeFileName(currentIncomingFile.name);
        incomingOpfsFileHandle = await batchDir.getFileHandle(`${currentIncomingFile.batchIndex || 0}-${safeName}`, { create: true });
        incomingFileWriter = await incomingOpfsFileHandle.createWritable();
    }

    if (!isDataChannelOpen()) {
        await safeAbortWriter();
        setTransferStatus("warning", "Peer disconnected before the transfer started.");
        return;
    }

    try {
        dataChannel.send(JSON.stringify({
            type: "FILE_ACCEPT",
            transferId: currentIncomingFile.transferId,
            batchId: incomingBatchId,
            acceptAll: incomingBatchAccepted
        }));
    } catch (error) {
        await safeAbortWriter();
        throw error;
    }

    incomingFileSection?.classList.add("hidden");
    showTransferProgress(
        incomingBatchTotal > 1
            ? `Receiving ${currentIncomingFile.batchIndex + 1}/${incomingBatchTotal}: ${currentIncomingFile.name}`
            : `Receiving: ${currentIncomingFile.name}`
    );
    bytesTransferred = 0;
    transferStartTime = performance.now();
    updateTransferControls();
}

function enqueueIncomingMessage(message) {
    incomingMessageQueue = incomingMessageQueue
        .then(() => handleIncomingTransferMessage(message))
        .catch((error) => {
            console.error("Incoming transfer error:", error);
            setTransferStatus("error", "File transfer failed on receiver.");
        });
    return incomingMessageQueue;
}
window.enqueueIncomingMessage = enqueueIncomingMessage;

async function handleIncomingTransferMessage(message) {
    if (typeof message === "string") {
        let data;
        try {
            data = JSON.parse(message);
        } catch {
            return;
        }

        if (data.type === "FILE_OFFER") return handleFileOffer(data);
        if (data.type === "FILE_ACCEPT") return handleFileAccepted(data);
        if (data.type === "FILE_END") return handleFileEnd(data);
        if (data.type === "FILE_CANCEL") return handleRemoteTransferCancel(data);
        return;
    }

    if (message instanceof ArrayBuffer) return writeIncomingChunk(message);
    if (message instanceof Blob) return writeIncomingChunk(await message.arrayBuffer());
}

function handleFileOffer(data) {
    // After the receiver accepts a batch, subsequent files are accepted
    // automatically without another button press.
    if (
        incomingBatchAccepted &&
        incomingBatchId === data.batchId &&
        !incomingFileWriter &&
        !currentIncomingFile
    ) {
        currentIncomingFile = data;
        prepareCurrentIncomingFile().catch((error) => {
            finishIncomingCancellation(error?.message || "Could not continue the batch transfer.");
        });
        return;
    }

    if (currentIncomingFile || incomingFileWriter) {
        setTransferStatus("warning", "Another incoming file is already being handled.");
        return;
    }

    currentIncomingFile = data;
    incomingBatchId = data.batchId || data.transferId;
    incomingBatchTotal = data.batchTotal || 1;
    incomingBatchAccepted = false;
    incomingSaveMode = "none";

    incomingFileName.textContent = data.batchTotal > 1
        ? `${data.batchIndex + 1}/${data.batchTotal}: ${data.name}`
        : data.name;
    incomingFileSize.textContent = formatBytes(data.size);
    incomingFileSection?.classList.remove("hidden");

    if (acceptFileButton) {
        acceptFileButton.textContent = data.batchTotal > 1 ? "Accept & Save All" : "Accept & Save";
        acceptFileButton.disabled = false;
    }

    showTransferProgress(
        data.batchTotal > 1
            ? `Incoming ${data.batchIndex + 1}/${data.batchTotal}`
            : `Incoming: ${data.name}`
    );
    setTransferStatus(
        "idle",
        data.batchTotal > 1
            ? `Ready to receive ${data.batchTotal} files. Accept once to save them all.`
            : "Waiting for you to accept the file."
    );
    updateTransferControls();
}

async function handleFileAccepted(data) {
    const outgoing = window.currentOutgoingFile;
    if (!outgoing || !window.outgoingTransferBusy || data.transferId !== outgoing.transferId) return;

    try {
        await startFileSending(outgoing.file, outgoing.transferId);
    } catch (error) {
        console.error("File read/transfer error:", error);
        stopOutgoingTransfer(error?.message || "The selected file could not be read.", false);
    }
}

async function startFileSending(file, transferId) {
    transferTitle.textContent = `Sending: ${file.name}`;
    showTransferProgress(`Sending: ${file.name}`);
    bytesTransferred = 0;
    transferStartTime = performance.now();

    // Keep chunks well below browser-specific RTCDataChannel message limits.
    const CHUNK_SIZE = 64 * 1024;
    const transferToken = window.outgoingTransferToken;

    for (let offset = 0; offset < file.size; offset += CHUNK_SIZE) {
        if (!window.outgoingTransferBusy || window.outgoingTransferToken !== transferToken) return "stopped";

        if (!isDataChannelOpen()) {
            stopOutgoingTransfer("Peer disconnected during the transfer.", true);
            return "stopped";
        }

        const chunk = await readFileChunkWithRetry(
            file,
            offset,
            Math.min(offset + CHUNK_SIZE, file.size)
        );

        if (!window.outgoingTransferBusy || window.outgoingTransferToken !== transferToken) return "stopped";
        if (!(await waitForBufferDrain(8 * 1024 * 1024, transferToken))) return "stopped";

        if (!isDataChannelOpen()) {
            stopOutgoingTransfer("Peer disconnected during the transfer.", true);
            return "stopped";
        }

        dataChannel.send(chunk);
        bytesTransferred += chunk.byteLength;
        updateProgress(bytesTransferred, file.size);
    }

    if (!isDataChannelOpen()) {
        stopOutgoingTransfer("Peer disconnected before the file finished.", true);
        return "stopped";
    }

    dataChannel.send(JSON.stringify({ type: "FILE_END", transferId }));
    window.currentOutgoingFile = null;

    if (window.outgoingFileQueue.length) {
        transferStatus.textContent = "Preparing next file...";
        setTimeout(() => {
            if (window.outgoingTransferBusy) sendNextQueuedFile();
        }, 100);
    } else {
        finishOutgoingTransfer();
    }

    return "complete";
}

async function readFileChunkWithRetry(file, start, end) {
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            return await file.slice(start, end).arrayBuffer();
        } catch (error) {
            if (attempt === 3) throw error;
            await new Promise((resolve) => setTimeout(resolve, attempt * 150));
        }
    }
}

function waitForBufferDrain(highWaterMark, transferToken) {
    return new Promise((resolve) => {
        const startedAt = performance.now();

        const check = () => {
            if (
                !window.outgoingTransferBusy ||
                window.outgoingTransferToken !== transferToken ||
                !isDataChannelOpen()
            ) {
                resolve(false);
                return;
            }

            if (dataChannel.bufferedAmount <= 2 * 1024 * 1024) {
                resolve(true);
                return;
            }

            if (performance.now() - startedAt > 30000) {
                stopOutgoingTransfer("Transfer timed out while sending data.", false);
                resolve(false);
                return;
            }

            setTimeout(check, 10);
        };

        if (dataChannel && dataChannel.bufferedAmount <= highWaterMark) resolve(true);
        else check();
    });
}

async function writeIncomingChunk(chunk) {
    if (!currentIncomingFile) return;

    try {
        if (incomingFileWriter) {
            await incomingFileWriter.write(chunk);
        } else {
            // Mobile/LAN fallback. The chunks are combined into a Blob only
            // after FILE_END, so the browser never tries to write to the OS
            // filesystem without permission.
            incomingFallbackChunks.push(chunk);
        }
    } catch (error) {
        console.error("Could not write incoming file chunk:", error);
        await safeAbortWriter();
        currentIncomingFile = null;
        incomingFallbackChunks = [];
        setTransferStatus("error", "Could not write the received file.");
        updateTransferControls();
        return;
    }

    bytesTransferred += chunk.byteLength;
    updateProgress(bytesTransferred, currentIncomingFile.size);
}

async function finishFallbackDownload(fileMeta) {
    if (!incomingFallbackChunks.length) throw new Error("No file data was received.");

    const blob = new Blob(incomingFallbackChunks, {
        type: fileMeta.mimeType || "application/octet-stream"
    });

    incomingFallbackChunks = [];
    const url = URL.createObjectURL(blob);
    const actions = document.getElementById("received-files-actions") || createReceivedFilesActions();
    actions.classList.remove("hidden");

    const row = document.createElement("div");
    row.className = "received-file-row";

    const link = document.createElement("a");
    link.href = url;
    link.download = fileMeta.name;
    link.className = "primary-btn received-file-link";
    link.textContent = `⬇ Download ${fileMeta.name}`;

    row.appendChild(link);
    actions.appendChild(row);

    // Some mobile browsers block programmatic downloads. The visible link
    // remains available so the user can tap it manually.
    setTimeout(() => {
        try { link.click(); } catch {}
    }, 50);
}

function createReceivedFilesActions() {
    const el = document.createElement("div");
    el.id = "received-files-actions";
    el.className = "received-files-actions";
    el.innerHTML = "<strong>Received files</strong><p>Tap a file below if your browser blocked automatic download.</p>";
    transferProgressSection?.appendChild(el);
    return el;
}

async function finishOpfsDownload(fileMeta) {
    if (!incomingOpfsFileHandle) throw new Error("Received file is not available.");

    const file = await incomingOpfsFileHandle.getFile();
    const url = URL.createObjectURL(file);
    const actions = document.getElementById("received-files-actions") || createReceivedFilesActions();
    actions.classList.remove("hidden");

    const row = document.createElement("div");
    row.className = "received-file-row";

    const link = document.createElement("a");
    link.href = url;
    link.download = fileMeta.name;
    link.className = "primary-btn received-file-link";
    link.textContent = `⬇ Download ${fileMeta.name}`;

    row.appendChild(link);
    actions.appendChild(row);

    setTimeout(() => {
        try { link.click(); } catch {}
    }, 50);
}

async function handleFileEnd(data) {
    if (!currentIncomingFile || data.transferId !== currentIncomingFile.transferId) return;

    const finishedFile = { ...currentIncomingFile };
    const finishedIndex = currentIncomingFile.batchIndex || 0;
    const total = currentIncomingFile.batchTotal || 1;

    try {
        if (incomingFileWriter) {
            await incomingFileWriter.close();
            incomingFileWriter = null;

            if (incomingSaveMode === "opfs") {
                await finishOpfsDownload(finishedFile);
            }
        } else {
            await finishFallbackDownload(finishedFile);
        }

        currentIncomingFile = null;
        incomingOpfsFileHandle = null;
        updateTransferControls();

        if (incomingBatchAccepted && incomingBatchId && finishedIndex + 1 < total) {
            setTransferStatus("idle", `Received ${finishedIndex + 1}/${total}. Waiting for next file...`);
        } else {
            incomingBatchAccepted = false;
            incomingDirectoryHandle = null;
            incomingSaveMode = "none";
            incomingBatchId = null;
            setTransferStatus(
                "success",
                total > 1 ? `All ${total} files received successfully` : "File received successfully"
            );
        }
    } catch (error) {
        console.error("Could not finalize incoming file:", error);
        await safeAbortWriter();
        incomingFallbackChunks = [];
        currentIncomingFile = null;
        incomingOpfsFileHandle = null;
        incomingBatchAccepted = false;
        incomingDirectoryHandle = null;
        incomingSaveMode = "none";
        incomingBatchId = null;
        setTransferStatus("error", "Could not finish saving the received file.");
        updateTransferControls();
    }
}

function cancelTransfer() {
    if (window.outgoingTransferBusy) {
        const transferId = window.currentOutgoingFile?.transferId;
        if (isDataChannelOpen() && transferId) {
            try {
                dataChannel.send(JSON.stringify({
                    type: "FILE_CANCEL",
                    transferId,
                    reason: "Sender cancelled the transfer."
                }));
            } catch {}
        }

        stopOutgoingTransfer("Transfer cancelled.", false, true);
        return;
    }

    if (currentIncomingFile || incomingFileWriter) {
        const transferId = currentIncomingFile?.transferId;
        if (isDataChannelOpen() && transferId) {
            try {
                dataChannel.send(JSON.stringify({
                    type: "FILE_CANCEL",
                    transferId,
                    reason: "Receiver cancelled the transfer."
                }));
            } catch {}
        }
        finishIncomingCancellation("Transfer cancelled.");
    }
}

if (cancelTransferButton) cancelTransferButton.addEventListener("click", cancelTransfer);

function finishOutgoingTransfer() {
    window.currentOutgoingFile = null;
    window.outgoingFileQueue = [];
    window.outgoingTransferBusy = false;
    window.outgoingBatchId = null;
    updateTransferControls();
    setTransferStatus("success", "All selected files sent successfully");
}

function stopOutgoingTransfer(message, expectedDisconnect = false, userCancelled = false) {
    if (!window.outgoingTransferBusy && !window.currentOutgoingFile && !window.outgoingFileQueue.length) return;

    window.outgoingTransferToken += 1;
    window.currentOutgoingFile = null;
    window.outgoingFileQueue = [];
    window.outgoingTransferBusy = false;
    window.outgoingBatchId = null;
    updateTransferControls();

    setTransferStatus(userCancelled || expectedDisconnect ? "warning" : "error", message);

    if (expectedDisconnect || userCancelled) console.warn("Outgoing transfer stopped:", message);
    else console.error("Outgoing transfer stopped:", message);
}

function failOutgoingTransfer(message) {
    stopOutgoingTransfer(message, true);
}

function resetOutgoingTransferState() {
    if (!window.outgoingTransferBusy) {
        window.currentOutgoingFile = null;
        window.outgoingFileQueue = [];
        updateTransferControls();
    }
}

async function safeAbortWriter() {
    if (!incomingFileWriter) return;
    try {
        if (typeof incomingFileWriter.abort === "function") await incomingFileWriter.abort();
    } catch {}
    incomingFileWriter = null;
}

async function finishIncomingCancellation(message) {
    await safeAbortWriter();
    currentIncomingFile = null;
    incomingBatchAccepted = false;
    incomingDirectoryHandle = null;
    incomingOpfsFileHandle = null;
    incomingSaveMode = "none";
    incomingFallbackChunks = [];
    incomingBatchId = null;
    incomingFileSection?.classList.add("hidden");
    updateTransferControls();
    setTransferStatus("warning", message);
}

async function handleRemoteTransferCancel(data) {
    if (
        currentIncomingFile?.transferId &&
        data.transferId &&
        currentIncomingFile.transferId !== data.transferId
    ) return;

    await finishIncomingCancellation(data.reason || "Peer cancelled the transfer.");
}

async function handleIncomingTransferDisconnect() {
    if (!(currentIncomingFile || incomingFileWriter)) return;

    await safeAbortWriter();
    currentIncomingFile = null;
    incomingBatchAccepted = false;
    incomingDirectoryHandle = null;
    incomingOpfsFileHandle = null;
    incomingSaveMode = "none";
    incomingFallbackChunks = [];
    incomingBatchId = null;
    incomingFileSection?.classList.add("hidden");
    updateTransferControls();
    setTransferStatus("warning", "File transfer interrupted because the peer disconnected.");
}

window.failOutgoingTransfer = failOutgoingTransfer;
window.resetOutgoingTransferState = resetOutgoingTransferState;
window.handleIncomingTransferDisconnect = handleIncomingTransferDisconnect;

function showTransferProgress(title = "Transfer") {
    transferProgressSection?.classList.remove("hidden");
    if (transferTitle) transferTitle.textContent = title;
    if (progressBar) progressBar.style.width = "0%";
    if (progressText) progressText.textContent = "0%";
    if (transferSpeed) transferSpeed.textContent = "Speed: 0 MB/s";
}

function setTransferStatus(type, message) {
    if (!transferStatus) return;

    transferStatus.textContent = message;
    transferStatus.dataset.status = type;

    if (["success", "warning", "error"].includes(type) && message !== lastToastMessage) {
        const now = Date.now();
        if (now - lastToastTime > 500) {
            lastToastMessage = message;
            lastToastTime = now;
            window.showToast?.(type, message);
        }
    }
}

function updateTransferControls() {
    const active = Boolean(window.outgoingTransferBusy || currentIncomingFile || incomingFileWriter);
    if (sendFileButton) sendFileButton.disabled = window.outgoingTransferBusy;
    if (cancelTransferButton) cancelTransferButton.classList.toggle("hidden", !active);
    if (acceptFileButton) acceptFileButton.disabled = Boolean(incomingFileWriter);

    selectedFilesContainer?.querySelectorAll(".file-remove-btn").forEach((button) => {
        button.disabled = window.outgoingTransferBusy;
    });
}

function updateProgress(current, total) {
    const percentage = total > 0 ? (current / total) * 100 : 0;
    if (progressBar) progressBar.style.width = `${Math.min(100, percentage)}%`;
    if (progressText) progressText.textContent = `${percentage.toFixed(1)}%`;

    const elapsed = (performance.now() - transferStartTime) / 1000;
    if (elapsed > 0 && transferSpeed) {
        transferSpeed.textContent = `Speed: ${formatBytes(current / elapsed)}/s`;
    }
}

function isDataChannelOpen() {
    return Boolean(dataChannel && dataChannel.readyState === "open");
}

function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return "0 Bytes";
    const units = ["Bytes", "KB", "MB", "GB", "TB"];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${units[i]}`;
}

function sanitizeFileName(name) {
    return String(name || "received-file").replace(/[\\/:*?"<>|]/g, "_");
}

renderSelectedFiles();
updateTransferControls();
