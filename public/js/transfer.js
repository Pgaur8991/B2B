let selectedFiles = [];

let currentIncomingFile = null;
let incomingFileWriter = null;
let transferStartTime = 0;
let bytesTransferred = 0;
let incomingMessageQueue = Promise.resolve();

window.currentOutgoingFile = null;
window.outgoingFileQueue = [];
window.outgoingTransferBusy = false;
window.outgoingTransferToken = 0;

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

        if (selectedFiles.length && transferStatus) {
            transferStatus.textContent =
                `${selectedFiles.length} file${selectedFiles.length > 1 ? "s" : ""} selected. Ready to send.`;
        }
    });
}


// ==========================================
// START OUTGOING TRANSFER
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
    if (!window.outgoingTransferBusy) return;

    if (!window.outgoingFileQueue.length) {
        window.currentOutgoingFile = null;
        window.outgoingTransferBusy = false;
        setTransferStatus("success", "All selected files sent successfully");
        return;
    }

    if (!isDataChannelOpen()) {
        stopOutgoingTransfer("Peer disconnected before the next file could start.", true);
        return;
    }

    const file = window.outgoingFileQueue.shift();

    if (!(file instanceof File)) {
        stopOutgoingTransfer("The selected file is no longer available.", false);
        return;
    }

    const transferId = crypto.randomUUID();

    window.currentOutgoingFile = {
        file,
        transferId
    };

    const offer = {
        type: "FILE_OFFER",
        transferId,
        name: file.name,
        size: file.size,
        mimeType: file.type || "application/octet-stream"
    };

    console.log("Sending file offer:", offer);

    try {
        dataChannel.send(JSON.stringify(offer));
        showTransferProgress(`Waiting for receiver: ${file.name}`);
    } catch (error) {
        console.error("Could not send file offer:", error);
        stopOutgoingTransfer("Could not send the file offer.", false);
    }
}


// ==========================================
// ACCEPT INCOMING FILE
// ==========================================

if (acceptFileButton) {
    acceptFileButton.addEventListener("click", async () => {
        if (!currentIncomingFile) return;

        if (incomingFileWriter) {
            transferStatus.textContent = "Another incoming file is already being saved.";
            return;
        }

        try {
            await prepareFileForWriting();
        } catch (error) {
            if (error?.name === "AbortError") {
                transferStatus.textContent = "Save cancelled. The file was not accepted.";
                return;
            }

            console.error("Could not prepare file:", error);
            transferStatus.textContent = "Could not create the destination file.";
        }
    });
}


async function prepareFileForWriting() {
    if (!currentIncomingFile) return;

    if (!("showSaveFilePicker" in window)) {
        alert("Your browser does not support direct file saving. Please use Chrome or Edge.");
        return;
    }

    const fileHandle = await window.showSaveFilePicker({
        suggestedName: currentIncomingFile.name
    });

    incomingFileWriter = await fileHandle.createWritable();

    if (!isDataChannelOpen()) {
        await safeAbortWriter();
        return;
    }

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
// DATA CHANNEL MESSAGE QUEUE
// ==========================================

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

        switch (data.type) {
            case "FILE_OFFER":
                handleFileOffer(data);
                break;
            case "FILE_ACCEPT":
                await handleFileAccepted(data);
                break;
            case "FILE_END":
                await handleFileEnd(data);
                break;
        }

        return;
    }

    if (message instanceof ArrayBuffer) {
        await writeIncomingChunk(message);
        return;
    }

    if (message instanceof Blob) {
        await writeIncomingChunk(await message.arrayBuffer());
    }
}


// ==========================================
// INCOMING FILE OFFER
// ==========================================

function handleFileOffer(data) {
    console.log("Incoming file:", data);

    if (currentIncomingFile || incomingFileWriter) {
        transferStatus.textContent = "Another incoming file is already being handled.";
        return;
    }

    currentIncomingFile = data;
    incomingFileName.textContent = data.name;
    incomingFileSize.textContent = formatBytes(data.size);
    incomingFileSection.classList.remove("hidden");
}


// ==========================================
// RECEIVER ACCEPTED FILE
// ==========================================

async function handleFileAccepted(data) {
    const outgoing = window.currentOutgoingFile;

    if (!outgoing || !window.outgoingTransferBusy) return;
    if (data.transferId !== outgoing.transferId) return;

    console.log("Receiver accepted file.");

    try {
        const result = await startFileSending(outgoing.file, outgoing.transferId);

        if (result === "stopped") {
            return;
        }
    } catch (error) {
        console.error("File read/transfer error:", error);
        stopOutgoingTransfer(
            error?.message || "The selected file could not be read.",
            false
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
        if (!window.outgoingTransferBusy || window.outgoingTransferToken !== transferToken) {
            return "stopped";
        }

        if (!isDataChannelOpen()) {
            stopOutgoingTransfer("Peer disconnected during the transfer.", true);
            return "stopped";
        }

        const end = Math.min(offset + CHUNK_SIZE, file.size);
        const chunk = await readFileChunkWithRetry(file, offset, end);

        if (!window.outgoingTransferBusy || window.outgoingTransferToken !== transferToken) {
            return "stopped";
        }

        const drained = await waitForBufferDrain(HIGH_WATER_MARK, transferToken);

        if (!drained) {
            return "stopped";
        }

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

    dataChannel.send(JSON.stringify({
        type: "FILE_END",
        transferId
    }));

    console.log("File transfer complete:", file.name);

    window.currentOutgoingFile = null;

    if (!window.outgoingFileQueue.length) {
        window.outgoingTransferBusy = false;
        setTransferStatus("success", "All selected files sent successfully");
        return "complete";
    }

    transferStatus.textContent = "Preparing next file...";

    setTimeout(() => {
        if (window.outgoingTransferBusy) {
            sendNextQueuedFile();
        }
    }, 100);

    return "queued";
}


// ==========================================
// SAFE FILE READING
// ==========================================

async function readFileChunkWithRetry(file, start, end) {
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            return await file.slice(start, end).arrayBuffer();
        } catch (error) {
            if (attempt === 3) throw error;
            await delay(attempt * 150);
        }
    }
}


function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}


// ==========================================
// BACKPRESSURE
// ==========================================

function waitForBufferDrain(highWaterMark, transferToken) {
    return new Promise((resolve) => {
        const startedAt = performance.now();
        const TIMEOUT = 30000;

        const check = () => {
            if (!window.outgoingTransferBusy || window.outgoingTransferToken !== transferToken) {
                resolve(false);
                return;
            }

            if (!isDataChannelOpen()) {
                resolve(false);
                return;
            }

            if (dataChannel.bufferedAmount <= 2 * 1024 * 1024) {
                resolve(true);
                return;
            }

            if (performance.now() - startedAt > TIMEOUT) {
                console.error("P2P data channel stopped draining.");
                stopOutgoingTransfer("Transfer timed out while sending data.", false);
                resolve(false);
                return;
            }

            setTimeout(check, 10);
        };

        if (dataChannel && dataChannel.bufferedAmount <= highWaterMark) {
            resolve(true);
        } else {
            check();
        }
    });
}


// ==========================================
// RECEIVE CHUNKS
// ==========================================

async function writeIncomingChunk(chunk) {
    if (!incomingFileWriter || !currentIncomingFile) return;

    try {
        await incomingFileWriter.write(chunk);
    } catch (error) {
        console.error("Could not write incoming file chunk:", error);
        setTransferStatus("error", "Could not write the received file.");
        await safeAbortWriter();
        currentIncomingFile = null;
        return;
    }

    bytesTransferred += chunk.byteLength;
    updateProgress(bytesTransferred, currentIncomingFile.size);
}


// ==========================================
// FILE END
// ==========================================

async function handleFileEnd(data) {
    if (!incomingFileWriter || !currentIncomingFile) return;
    if (data.transferId !== currentIncomingFile.transferId) return;

    console.log("File transfer finished:", currentIncomingFile.name);

    try {
        await incomingFileWriter.close();
        incomingFileWriter = null;

        setTransferStatus("success", "File received successfully");
        currentIncomingFile = null;
    } catch (error) {
        console.error("Could not finalize incoming file:", error);
        await safeAbortWriter();
        currentIncomingFile = null;
        setTransferStatus("error", "Could not finish saving the received file.");
    }
}


// ==========================================
// DISCONNECT / CANCEL
// ==========================================

function stopOutgoingTransfer(message, expectedDisconnect = false) {
    const hasActiveTransfer =
        window.outgoingTransferBusy ||
        window.currentOutgoingFile ||
        window.outgoingFileQueue.length > 0;

    if (!hasActiveTransfer) return;

    window.outgoingTransferToken += 1;
    window.currentOutgoingFile = null;
    window.outgoingFileQueue = [];
    window.outgoingTransferBusy = false;

    setTransferStatus(expectedDisconnect ? "warning" : "error", message);

    if (expectedDisconnect) {
        console.warn("Outgoing transfer stopped:", message);
    } else {
        console.error("Outgoing transfer stopped:", message);
    }
}

function failOutgoingTransfer(message) {
    stopOutgoingTransfer(message, true);
}

function resetOutgoingTransferState() {
    if (!window.outgoingTransferBusy) {
        window.currentOutgoingFile = null;
        window.outgoingFileQueue = [];
    }
}

async function safeAbortWriter() {
    if (!incomingFileWriter) return;

    try {
        if (typeof incomingFileWriter.abort === "function") {
            await incomingFileWriter.abort();
        }
    } catch (error) {
        console.warn("Could not abort incomplete incoming file:", error);
    }

    incomingFileWriter = null;
}

async function handleIncomingTransferDisconnect() {
    const hadIncomingTransfer = Boolean(currentIncomingFile || incomingFileWriter);

    if (!hadIncomingTransfer) return;

    await safeAbortWriter();
    currentIncomingFile = null;

    if (incomingFileSection) {
        incomingFileSection.classList.add("hidden");
    }

    setTransferStatus("warning", "File transfer interrupted because the peer disconnected.");
}

window.failOutgoingTransfer = failOutgoingTransfer;
window.resetOutgoingTransferState = resetOutgoingTransferState;
window.handleIncomingTransferDisconnect = handleIncomingTransferDisconnect;


// ==========================================
// UI HELPERS
// ==========================================

function showTransferProgress(title = "Transfer") {
    transferProgressSection.classList.remove("hidden");
    transferTitle.textContent = title;
    progressBar.style.width = "0%";
    progressText.textContent = "0%";
    transferSpeed.textContent = "Speed: 0 MB/s";
}

function setTransferStatus(type, message) {
    if (!transferStatus) return;

    transferStatus.textContent = message;
    transferStatus.dataset.status = type;
}

function updateProgress(current, total) {
    const percentage = total > 0 ? (current / total) * 100 : 0;

    progressBar.style.width = `${Math.min(100, percentage)}%`;
    progressText.textContent = `${percentage.toFixed(1)}%`;

    const elapsed = (performance.now() - transferStartTime) / 1000;
    if (elapsed > 0) {
        const speed = current / elapsed;
        transferSpeed.textContent = `Speed: ${formatBytes(speed)}/s`;
    }
}

function isDataChannelOpen() {
    return Boolean(dataChannel && dataChannel.readyState === "open");
}

function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return "0 Bytes";

    const units = ["Bytes", "KB", "MB", "GB", "TB"];
    const i = Math.min(
        Math.floor(Math.log(bytes) / Math.log(1024)),
        units.length - 1
    );

    return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${units[i]}`;
}
