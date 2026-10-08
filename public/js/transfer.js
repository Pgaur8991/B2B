let selectedFiles = [];

let currentIncomingFile = null;
let incomingFileWriter = null;
let transferStartTime = null;
let bytesTransferred = 0;

let incomingMessageQueue = Promise.resolve();

window.currentOutgoingFile = null;
window.outgoingFileQueue = [];
window.outgoingTransferBusy = false;


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

        // Take a snapshot so a later file-picker action cannot replace this batch.
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

    const file = window.outgoingFileQueue.shift();

    if (!(file instanceof File)) {
        failOutgoingTransfer("The selected file is no longer available.");
        return;
    }

    // Keep the exact File object alive until its transfer is complete.
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
    // RTCDataChannel can fire multiple message events while an async write is pending.
    // Serializing them prevents chunks and FILE_END from racing each other.
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
    if (!window.currentOutgoingFile) {
        return;
    }

    if (data.transferId !== window.currentOutgoingFile.transferId) {
        return;
    }

    console.log("Receiver accepted file.");

    try {
        await startFileSending(window.currentOutgoingFile.file);
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

async function startFileSending(file) {
    console.log("Starting file transfer:", file.name);

    transferTitle.textContent = `Sending: ${file.name}`;
    showTransferProgress();

    bytesTransferred = 0;
    transferStartTime = performance.now();

    const CHUNK_SIZE = 64 * 1024;
    const HIGH_WATER_MARK = 8 * 1024 * 1024;
    const LOW_WATER_MARK = 2 * 1024 * 1024;

    dataChannel.bufferedAmountLowThreshold = LOW_WATER_MARK;

    for (let offset = 0; offset < file.size; offset += CHUNK_SIZE) {
        if (!dataChannel || dataChannel.readyState !== "open") {
            throw new Error("P2P connection closed during file transfer.");
        }

        const end = Math.min(offset + CHUNK_SIZE, file.size);
        const chunk = await readFileChunkWithRetry(file, offset, end);

        while (dataChannel.bufferedAmount > HIGH_WATER_MARK) {
            await waitForBufferDrain();
        }

        dataChannel.send(chunk);

        bytesTransferred += chunk.byteLength;
        updateProgress(bytesTransferred, file.size);
    }

    dataChannel.send(JSON.stringify({
        type: "FILE_END",
        transferId: window.currentOutgoingFile.transferId
    }));

    transferStatus.textContent = "✅ File sent successfully";
    console.log("File transfer complete:", file.name);

    window.currentOutgoingFile = null;

    // Give the receiver's ordered message queue a moment to process FILE_END
    // before the next FILE_OFFER arrives.
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

function waitForBufferDrain() {
    return new Promise((resolve) => {
        const check = () => {
            if (!dataChannel || dataChannel.readyState !== "open") {
                resolve();
                return;
            }

            if (dataChannel.bufferedAmount <= 2 * 1024 * 1024) {
                resolve();
            } else {
                setTimeout(check, 10);
            }
        };

        check();
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
// OUTGOING FAILURE
// ==========================================

function failOutgoingTransfer(message) {
    window.currentOutgoingFile = null;
    window.outgoingFileQueue = [];
    window.outgoingTransferBusy = false;

    transferStatus.textContent = `❌ ${message}`;
    console.error("Outgoing transfer stopped:", message);
}


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
