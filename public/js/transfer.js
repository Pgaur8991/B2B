let selectedFiles = [];

let currentIncomingFile = null;

let incomingFileWriter = null;

let transferStartTime = null;

let bytesTransferred = 0;

let lastProgressUpdate = 0;


// ==========================================
// ELEMENTS
// ==========================================

const fileInput =
    document.getElementById("file-input");

const sendFileButton =
    document.getElementById("send-file-btn");

const incomingFileSection =
    document.getElementById(
        "incoming-file-section"
    );

const incomingFileName =
    document.getElementById(
        "incoming-file-name"
    );

const incomingFileSize =
    document.getElementById(
        "incoming-file-size"
    );

const acceptFileButton =
    document.getElementById(
        "accept-file-btn"
    );

const transferProgressSection =
    document.getElementById(
        "transfer-progress-section"
    );

const progressBar =
    document.getElementById(
        "progress-bar"
    );

const progressText =
    document.getElementById(
        "progress-text"
    );

const transferSpeed =
    document.getElementById(
        "transfer-speed"
    );

const transferStatus =
    document.getElementById(
        "transfer-status"
    );

const transferTitle =
    document.getElementById(
        "transfer-title"
    );


// ==========================================
// FILE SELECTION
// ==========================================

fileInput.addEventListener(
    "change",
    () => {

        selectedFiles =
            Array.from(fileInput.files);

        console.log(
            "Selected files:",
            selectedFiles
        );

    }
);


// ==========================================
// SEND FILE
// ==========================================

sendFileButton.addEventListener(
    "click",
    async () => {

        if (!selectedFiles.length) {

            alert(
                "Please select a file first."
            );

            return;

        }


        if (
            !dataChannel ||
            dataChannel.readyState !== "open"
        ) {

            alert(
                "P2P connection is not ready."
            );

            return;

        }


        // For the first version,
        // send one file at a time.

        const file =
            selectedFiles[0];


        await sendFile(file);

    }
);


// ==========================================
// SEND FILE METADATA
// ==========================================

async function sendFile(file) {

    const transferId =
        crypto.randomUUID();


    const metadata = {

        type: "FILE_OFFER",

        transferId: transferId,

        name: file.name,

        size: file.size,

        mimeType:
            file.type || "application/octet-stream"

    };


    console.log(
        "Sending file offer:",
        metadata
    );


    dataChannel.send(
        JSON.stringify(metadata)
    );


    showTransferProgress(
        `Waiting for receiver: ${file.name}`
    );


    // Store sender state

    window.currentOutgoingFile = {

        file: file,

        transferId: transferId

    };

}


// ==========================================
// ACCEPT INCOMING FILE
// ==========================================

acceptFileButton.addEventListener(
    "click",
    async () => {

        if (!currentIncomingFile) {

            return;

        }


        try {

            await prepareFileForWriting();

        } catch (error) {

            console.error(
                "Could not prepare file:",
                error
            );

            transferStatus.textContent =
                "Could not create file.";

        }

    }
);


// ==========================================
// PREPARE FILE WRITER
// ==========================================

async function prepareFileForWriting() {

    if (
        !("showSaveFilePicker" in window)
    ) {

        alert(
            "Your browser does not support direct file saving. Please use Chrome or Edge."
        );

        return;

    }


    const fileHandle =
        await window.showSaveFilePicker({

            suggestedName:
                currentIncomingFile.name

        });


    incomingFileWriter =
        await fileHandle.createWritable();


    console.log(
        "File writer ready."
    );


    dataChannel.send(
        JSON.stringify({

            type: "FILE_ACCEPT",

            transferId:
                currentIncomingFile.transferId

        })
    );


    incomingFileSection.classList.add(
        "hidden"
    );


    showTransferProgress(
        `Receiving: ${currentIncomingFile.name}`
    );


    bytesTransferred = 0;

    transferStartTime =
        performance.now();

}


// ==========================================
// HANDLE INCOMING DATA
// ==========================================

async function handleIncomingTransferMessage(
    message
) {

    // ------------------------------
    // TEXT MESSAGE
    // ------------------------------

    if (typeof message === "string") {

        let data;


        try {

            data = JSON.parse(message);

        } catch {

            return;

        }


        // File offer

        if (
            data.type === "FILE_OFFER"
        ) {

            handleFileOffer(data);

        }


        // Sender accepted

        if (
            data.type === "FILE_ACCEPT"
        ) {

            await handleFileAccepted(data);

        }


        // Transfer finished

        if (
            data.type === "FILE_END"
        ) {

            await handleFileEnd(data);

        }


        return;

    }


    // ------------------------------
    // BINARY CHUNK
    // ------------------------------

    if (
        message instanceof ArrayBuffer
    ) {

        await writeIncomingChunk(
            message
        );

        return;

    }


    if (
        message instanceof Blob
    ) {

        const buffer =
            await message.arrayBuffer();

        await writeIncomingChunk(
            buffer
        );

    }

}


// ==========================================
// FILE OFFER
// ==========================================

function handleFileOffer(data) {

    console.log(
        "Incoming file:",
        data
    );


    currentIncomingFile = data;


    incomingFileName.textContent =
        data.name;


    incomingFileSize.textContent =
        formatBytes(data.size);


    incomingFileSection.classList.remove(
        "hidden"
    );

}


// ==========================================
// FILE ACCEPTED
// ==========================================

async function handleFileAccepted(data) {

    if (
        !window.currentOutgoingFile
    ) {

        return;

    }


    if (
        data.transferId !==
        window.currentOutgoingFile.transferId
    ) {

        return;

    }


    console.log(
        "Receiver accepted file."
    );


    await startFileSending(
        window.currentOutgoingFile.file
    );

}


// ==========================================
// SEND FILE CHUNKS
// ==========================================

async function startFileSending(file) {

    console.log(
        "Starting file transfer:",
        file.name
    );


    transferTitle.textContent =
        `Sending: ${file.name}`;


    showTransferProgress();


    bytesTransferred = 0;

    transferStartTime =
        performance.now();


    const CHUNK_SIZE =
        64 * 1024;


    const HIGH_WATER_MARK =
        8 * 1024 * 1024;


    const LOW_WATER_MARK =
        2 * 1024 * 1024;


    dataChannel.bufferedAmountLowThreshold =
        LOW_WATER_MARK;


    for (
        let offset = 0;
        offset < file.size;
        offset += CHUNK_SIZE
    ) {

        const chunk =
            await file.slice(
                offset,
                Math.min(
                    offset + CHUNK_SIZE,
                    file.size
                )
            ).arrayBuffer();


        // Backpressure

        while (
            dataChannel.bufferedAmount >
            HIGH_WATER_MARK
        ) {

            await waitForBufferDrain();

        }


        dataChannel.send(chunk);


        bytesTransferred +=
            chunk.byteLength;


        updateProgress(
            bytesTransferred,
            file.size
        );

    }


    dataChannel.send(
        JSON.stringify({

            type: "FILE_END",

            transferId:
                window.currentOutgoingFile
                    .transferId

        })
    );


    transferStatus.textContent =
        "✅ File sent successfully";


    console.log(
        "File transfer complete."
    );

}


// ==========================================
// BUFFER DRAIN
// ==========================================

function waitForBufferDrain() {

    return new Promise(
        (resolve) => {

            const check =
                () => {

                    if (
                        dataChannel
                            .bufferedAmount <=
                        2 * 1024 * 1024
                    ) {

                        resolve();

                    } else {

                        setTimeout(
                            check,
                            10
                        );

                    }

                };


            check();

        }
    );

}


// ==========================================
// WRITE INCOMING CHUNK
// ==========================================

async function writeIncomingChunk(
    chunk
) {

    if (!incomingFileWriter) {

        console.warn(
            "Received chunk but file writer is not ready."
        );

        return;

    }


    await incomingFileWriter.write(
        chunk
    );


    bytesTransferred +=
        chunk.byteLength;


    updateProgress(
        bytesTransferred,
        currentIncomingFile.size
    );

}


// ==========================================
// FILE END
// ==========================================

async function handleFileEnd(data) {

    if (!incomingFileWriter) {

        return;

    }


    console.log(
        "File transfer finished."
    );


    await incomingFileWriter.close();


    incomingFileWriter = null;


    transferStatus.textContent =
        "✅ File received successfully";


    currentIncomingFile = null;

}


// ==========================================
// PROGRESS
// ==========================================

function updateProgress(
    current,
    total
) {

    const percentage =
        total === 0
            ? 0
            : (current / total) * 100;


    progressBar.style.width =
        `${percentage}%`;


    progressText.textContent =
        `${percentage.toFixed(1)}%`;


    const elapsed =
        (performance.now() -
            transferStartTime) /
        1000;


    if (elapsed > 0) {

        const speed =
            current / elapsed;


        transferSpeed.textContent =
            `Speed: ${formatBytes(speed)}/s`;

    }

}


// ==========================================
// SHOW PROGRESS
// ==========================================

function showTransferProgress(
    title = "Transfer"
) {

    transferProgressSection.classList.remove(
        "hidden"
    );


    transferTitle.textContent =
        title;

}


// ==========================================
// FORMAT BYTES
// ==========================================

function formatBytes(bytes) {

    if (bytes === 0) {

        return "0 Bytes";

    }


    const units = [
        "Bytes",
        "KB",
        "MB",
        "GB",
        "TB"
    ];


    const i =
        Math.floor(
            Math.log(bytes) /
            Math.log(1024)
        );


    return (
        `${(bytes /
            Math.pow(1024, i))
            .toFixed(2)} ${units[i]}`
    );

}