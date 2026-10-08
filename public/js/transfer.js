let selectedFiles = [];

let currentIncomingFile = null;
let incomingFileWriter = null;
let transferStartTime = null;
let bytesTransferred = 0;

let incomingMessageQueue = Promise.resolve();

window.currentOutgoingFile = null;
window.outgoingFileQueue = [];
window.outgoingTransferBusy = false;
window.outgoingTransferToken = 0;


// ==========================================
// ELEMENTS
// ==========================================

const fileInput = document.getElementById("file-input");
const sendFileButton = document.getElementById("send-file-btn");

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


// ==========================================
// FILE SELECTION
// ==========================================

if (fileInput) {
    fileInput.addEventListener("change", () => {
        selectedFiles = Array.from(fileInput.files || []);

        console.log("Selected files:", selectedFiles);

        if (selectedFiles.length) {
            transferStatus.textContent =
                `${selectedFiles.length} file${selectedFiles.length > 1 ? "s" : ""} selected. Ready to send.`;
        }
    });
}


// ==========================================
// SEND FILES
// ==========================================

if (sendFileButton) {
    sendFileButton.addEventListener("click", async () => {
        if (!selectedFiles.length) {
            alert("Please select a file first.");
            return;
        }

        if (!dataChannel || dataChannel.readyState !== "open") {
            alert("P2P connection is not ready.");
            return;
        }

        if (window.outgoingTransferBusy) {
            transferStatus.textContent = "A file transfer is already in progress.";
            return;
        }

        window.outgoingTransferToken += 1;
        window.outgoingFileQueue = [...selectedFiles];
        window.outgoingTransferBusy = true;

        console.log("Starting transfer queue:", window.outgoingFileQueue);

        await sendNextQueuedFile();
    });
}


async function sendNextQueuedFile() {
    if (!window.outgoingTransferBusy) {
        return;
    }

    if (!window.outgoingFileQueue.length) {
        window.currentOutgoingFile = null;
        window.outgoingTransferBusy = false;
        transferStatus.textContent = "✅ All selected files sent successfully";
        return;
    }

    if (!dataChannel || dataChannel.readyState !== "open") {
        failOutgoingTransfer("Peer is no longer connected.");
        return;
    }

    const file = window.outgoingFileQueue.shift();

    if (!(file instanceof File)) {
        failOutgoingTransfer("The selected file is no longer available.");
        return;
    }

    window.currentOutgoingFile = {
        file,
        transferId: crypto.randomUUID()
    };

    const metadata = {
        type: "FILE_OFFER",
        transferId: window.currentOutgoingFile.transferId,
        name: file.name,
        size: file.size,
        mimeType: file.type || "application/octet-stream"
    };

    console.log("Sending file offer:", metadata);

    try {
        dataChannel.send(JSON.stringify(metadata));
        showTransferProgress(`Waiting for receiver: ${file.name}`);
    } catch (error) {
        console.error("Could not send file offer:", error);
        failOutgoingTransfer("Could not send the file offer.");
    }
}


// ==========================================
// ACCEPT INCOMING FILE
// ==========================================

if (acceptFileButton) {
    acceptFileButton.addEventListener("click", async () => {
        if (!currentIncomingFile) {
            return;
        }

        if (incomingFileWriter) {
            transferStatus.textContent = "Another incoming file is already being saved.";
            return;
        }

        try {
            await prepareFileForWriting();
        } catch (error) {
            console.error("Could not prepare file:", error);
            transferStatus.textContent = "Could not create the destination file.";
        }
    });
}


// ==========================================
// PREPARE FILE WRITER
// ==========================================

async function prepareFileForWriting() {
    if (!("showSaveFilePicker" in window)) {
        alert("Your browser does not support direct file saving. Please use Chrome or Edge.");
        return;
    }

    const fileHandle = await window.showSaveFilePicker({
        suggestedName: currentIncomingFile.name
    });

    incomingFileWriter = await fileHandle.createWritable();

    console.log("File writer ready.");

    dataChannel.send(JSON.stringify({
        type: "FILE_ACCEPT",
        transferId: currentIncomingFile.transferId
    }));

    incomingFileSection.classList.add("hidden");

    showTransferProgress(`Receiving: ${currentIncomingFile.name}`);

    bytesTransferred = 0;
    transferStartTime = performance.now();
}


// ==========================================
// HANDLE INCOMING DATA
// ==========================================

function enqueueIncomingMessage(message) {
    incomingMessageQueue = incomingMessageQueue
        .then(() => handleIncomingTransferMessage(message))
        .catch((error) => {
            console.error("Incoming transfer error:", error);
            transferStatus.textContent = "❌ File transfer failed on receiver.";
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

        if (data.type === "FILE_OFFER") {
            handleFileOffer(data);
        }

        if (data.type === "FILE_ACCEPT") {
            await handleFileAccepted(data);
        }

        if (data.type === "FILE_END") {
            await handleFileEnd(data);
        }

        return;
    }

    if (message instanceof ArrayBuffer) {
        await writeIncomingChunk(message);
        return;
    }

    if (message instanceof Blob) {
        const buffer = await message.arrayBuffer();
        await writeIncomingChunk(buffer);
    }
}


// ==========================================
// FILE OFFER
// ==========================================

function handleFileOffer(data) {
    console.log("Incoming file:", data);

    if (currentIncomingFile || incomingFileWriter) {
        console.warn("Incoming file is already waiting or transferring.");
        transferStatus.textContent = "Another incoming file is already being handled.";
        return;
    }

    currentIncomingFile = data;

    incomingFileName.textContent = data.name;
    incomingFileSize.textContent = formatBytes(data.size);

    incomingFileSection.classList.remove("hidden");
}


// ==========================================
// FILE ACCEPTED
// ==========================================

async function handleFileAccepted(data) {
    if (!window.currentOutgoingFile || !window.outgoingTransferBusy) {
        return;
    }

    if (data.transferId !== window.currentOutgoingFile.transferId) {
        return;
    }

    console.log("Receiver accepted file.");

    try {
        await startFileSending(
            window.currentOutgoingFile.file,
            window.currentOutgoingFile.transferId
        );
    } catch (error) {
        console.error("File read/transfer error:", error);
        failOutgoingTransfer(
            error?.message || "The selected file could not be read."
        );
    }
}


// ==========================================
// SEND FILE CHUNKS
// ==========================================

async function startFileSending(file, transferId) {
    console.log("Starting file transfer:", file.name);

    transferTitle.textContent = `Sending: ${file.name}`;
    showTransferProgress();

    bytesTransferred = 0;
    transferStartTime = performance.now();

    const CHUNK_SIZE = 64 * 1024;
    const HIGH_WATER_MARK = 8 * 1024 * 1024;
    const LOW_WATER_MARK = 2 * 1024 * 1024;
    const transferToken = window.outgoingTransferToken;

    dataChannel.bufferedAmountLowThreshold = LOW_WATER_MARK;

    for (let offset = 0; offset < file.size; offset += CHUNK_SIZE) {
        if (
            !window.outgoingTransferBusy ||
            window.outgoingTransferToken !== transferToken ||
            !window.currentOutgoingFile ||
            window.currentOutgoingFile.transferId !== transferId
        ) {
            throw new Error("File transfer was cancelled.");
        }

        if (!dataChannel || dataChannel.readyState !== "open") {
            throw new Error("P2P connection closed during file transfer.");
        }

        const end = Math.min(offset + CHUNK_SIZE, file.size);
        const chunk = await readFileChunkWithRetry(file, offset, end);

        if (!window.outgoingTransferBusy || window.outgoingTransferToken !== transferToken) {
            throw new Error("File transfer was cancelled.");
        }

        await waitForBufferDrain(HIGH_WATER_MARK, transferToken);

        if (!dataChannel || dataChannel.readyState !== "open") {
            throw new Error("P2P connection closed during file transfer.");
        }

        dataChannel.send(chunk);

        bytesTransferred += chunk.byteLength;
        updateProgress(bytesTransferred, file.size);
    }

    if (!dataChannel || dataChannel.readyState !== "open") {
        throw new Error("P2P connection closed before the file could finish.");
    }

    dataChannel.send(JSON.stringify({
        type: "FILE_END",
        transferId
    }));

    console.log("File transfer complete:", file.name);

    window.currentOutgoingFile = null;

    if (window.outgoingFileQueue.length === 0) {
        window.outgoingTransferBusy = false;
        transferStatus.textContent = "✅ All selected files sent successfully";
        return;
    }

    transferStatus.textContent = "Preparing next file...";

    setTimeout(() => {
        sendNextQueuedFile();
    }, 100);
}


// ==========================================
// SAFE FILE READING
// ==========================================

async function readFileChunkWithRetry(file, start, end) {
    const maxAttempts = 3;
    let lastError = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await file.slice(start, end).arrayBuffer();
        } catch (error) {
            lastError = error;
            console.warn(
                `Could not read file chunk ${start}-${end} (attempt ${attempt}/${maxAttempts}).`,
                error
            );

            if (attempt < maxAttempts) {
                await delay(attempt * 150);
            }
        }
    }

    throw new Error(
        `The file could not be read at byte ${start}. ` +
        `It may have been moved, deleted, locked, or become unavailable.`
    );
}

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}


// ==========================================
// BUFFER DRAIN
// ==========================================

function waitForBufferDrain(highWaterMark, transferToken) {
    return new Promise((resolve, reject) => {
        const startedAt = performance.now();
        const TIMEOUT = 30000;

        const check = () => {
            if (!window.outgoingTransferBusy || window.outgoingTransferToken !== transferToken) {
                reject(new Error("File transfer was cancelled."));
                return;
            }

            if (!dataChannel || dataChannel.readyState !== "open") {
                reject(new Error("P2P connection closed during file transfer."));
                return;
            }

            if (dataChannel.bufferedAmount <= 2 * 1024 * 1024) {
                resolve();
                return;
            }

            if (performance.now() - startedAt > TIMEOUT) {
                reject(new Error("P2P data channel stopped draining."));
                return;
            }

            setTimeout(check, 10);
        };

        if (dataChannel.bufferedAmount <= highWaterMark) {
            resolve();
        } else {
            check();
        }
    });
}


// ==========================================
// WRITE INCOMING CHUNK
// ==========================================

async function writeIncomingChunk(chunk) {
    if (!incomingFileWriter || !currentIncomingFile) {
        console.warn("Received chunk but file writer is not ready.");
        return;
    }

    await incomingFileWriter.write(chunk);

    bytesTransferred += chunk.byteLength;
    updateProgress(bytesTransferred, currentIncomingFile.size);
}


// ==========================================
// FILE END
// ==========================================

async function handleFileEnd(data) {
    if (!incomingFileWriter || !currentIncomingFile) {
        return;
    }

    if (data.transferId !== currentIncomingFile.transferId) {
        return;
    }

    console.log("File transfer finished:", currentIncomingFile.name);

    await incomingFileWriter.close();
    incomingFileWriter = null;

    transferStatus.textContent = "✅ File received successfully";

    currentIncomingFile = null;
}


// ==========================================
// DISCONNECT / CANCEL
// ==========================================

function failOutgoingTransfer(message) {
    const hasActiveTransfer =
        window.outgoingTransferBusy ||
        window.currentOutgoingFile ||
        window.outgoingFileQueue.length > 0;

    if (!hasActiveTransfer) {
        return;
    }

    window.outgoingTransferToken += 1;
    window.currentOutgoingFile = null;
    window.outgoingFileQueue = [];
    window.outgoingTransferBusy = false;

    transferStatus.textContent = `❌ ${message}`;
    console.error("Outgoing transfer stopped:", message);
}

function resetOutgoingTransferState() {
    if (!window.outgoingTransferBusy) {
        window.currentOutgoingFile = null;
        window.outgoingFileQueue = [];
    }
}

async function handleIncomingTransferDisconnect() {
    const hadIncomingTransfer = Boolean(currentIncomingFile || incomingFileWriter);

    if (!hadIncomingTransfer) {
        return;
    }

    try {
        if (incomingFileWriter && typeof incomingFileWriter.abort === "function") {
            await incomingFileWriter.abort();
        }
    } catch (error) {
        console.warn("Could not abort incomplete incoming file:", error);
    }

    incomingFileWriter = null;
    currentIncomingFile = null;

    if (incomingFileSection) {
        incomingFileSection.classList.add("hidden");
    }

    transferStatus.textContent = "❌ File transfer interrupted because the peer disconnected.";
}

window.failOutgoingTransfer = failOutgoingTransfer;
window.resetOutgoingTransferState = resetOutgoingTransferState;
window.handleIncomingTransferDisconnect = handleIncomingTransferDisconnect;


// ==========================================
// PROGRESS
// ==========================================

function updateProgress(current, total) {
    const percentage = total === 0 ? 0 : (current / total) * 100;

    progressBar.style.width = `${percentage}%`;
    progressText.textContent = `${percentage.toFixed(1)}%`;

    const elapsed = (performance.now() - transferStartTime) / 1000;

    if (elapsed > 0) {
        const speed = current / elapsed;
        transferSpeed.textContent = `Speed: ${formatBytes(speed)}/s`;
    }
}


// ==========================================
// SHOW PROGRESS
// ==========================================

function showTransferProgress(title = "Transfer") {
    transferProgressSection.classList.remove("hidden");
    transferTitle.textContent = title;
}


// ==========================================
// FORMAT BYTES
// ==========================================

function formatBytes(bytes) {
    if (bytes === 0) {
        return "0 Bytes";
    }

    const units = ["Bytes", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));

    return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${units[i]}`;
}
