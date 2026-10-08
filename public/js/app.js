const transferSection = document.getElementById("transfer-section");
const createRoomButton = document.getElementById("create-room-btn");
const joinRoomButton = document.getElementById("join-room-btn");
const roomCodeInput = document.getElementById("room-code-input");
const homeScreen = document.getElementById("home-screen");
const roomScreen = document.getElementById("room-screen");
const roomCodeDisplay = document.getElementById("room-code");
const connectionStatus = document.getElementById("connection-status");
const roomStatusText = document.getElementById("room-status-text");
const errorMessage = document.getElementById("error-message");
const copyRoomButton = document.getElementById("copy-room-btn");
const qrRoomButton = document.getElementById("qr-room-btn");
const qrModal = document.getElementById("qr-modal");
const qrCanvas = document.getElementById("qr-canvas");
const qrRoomCode = document.getElementById("qr-room-code");
const closeQrButton = document.getElementById("close-qr-btn");
const fileInput = document.getElementById("file-input");
const selectedFiles = document.getElementById("selected-files");
const dropZone = document.getElementById("drop-zone");

function clearError() {
    if (errorMessage) errorMessage.textContent = "";
}

function showError(message) {
    if (errorMessage) errorMessage.textContent = message;
    console.error("B2B:", message);
}

window.clearError = clearError;
window.showError = showError;

if (createRoomButton) {
    createRoomButton.addEventListener("click", () => {
        clearError();
        console.log("B2B: Create Room clicked");

        if (typeof window.createRoom === "function") {
            window.createRoom();
        } else {
            showError("Signaling code is not loaded. Refresh the page.");
        }
    });
}

if (joinRoomButton) {
    joinRoomButton.addEventListener("click", () => {
        clearError();

        const roomCode = roomCodeInput?.value.trim().toUpperCase() || "";

        if (roomCode.length !== 6) {
            showError("Please enter a valid 6-character room code.");
            return;
        }

        if (typeof window.joinRoom === "function") {
            window.joinRoom(roomCode);
        } else {
            showError("Signaling code is not loaded. Refresh the page.");
        }
    });
}

window.showRoom = function showRoom(code) {
    console.log("B2B: Showing room", code);

    if (!homeScreen || !roomScreen || !roomCodeDisplay) {
        showError("Room screen UI is missing. Please refresh the page.");
        return;
    }

    homeScreen.classList.add("hidden");
    roomScreen.classList.remove("hidden");
    roomCodeDisplay.textContent = code;

    if (roomStatusText) {
        roomStatusText.textContent = "Waiting for another browser...";
    }
};

window.updateStatus = function updateStatus(message) {
    if (connectionStatus) connectionStatus.textContent = message;

    if (roomStatusText && message.includes("Direct P2P connection ready")) {
        roomStatusText.textContent = message;
    }
};

if (copyRoomButton) {
    copyRoomButton.addEventListener("click", async () => {
        const code = roomCodeDisplay?.textContent.trim() || "";

        if (!code || code === "------") return;

        try {
            await navigator.clipboard.writeText(code);
            const label = copyRoomButton.querySelector(".copy-label");
            if (label) label.textContent = "Copied";

            setTimeout(() => {
                if (label) label.textContent = "Copy";
            }, 1500);
        } catch (error) {
            showError("Unable to copy room code.");
            console.error("B2B: Clipboard error", error);
        }
    });
}

function openQrModal() {
    const code = roomCodeDisplay?.textContent.trim() || "";

    if (!code || code === "------") return;

    if (!window.QRCode) {
        showError("QR code library did not load. You can still copy the room code.");
        return;
    }

    qrRoomCode.textContent = code;

    QRCode.toCanvas(qrCanvas, code, {
        width: 220,
        margin: 2,
        errorCorrectionLevel: "M"
    }, (error) => {
        if (error) {
            console.error("B2B: QR error", error);
            showError("Could not create the QR code.");
            return;
        }

        qrModal?.classList.remove("hidden");
        qrModal?.setAttribute("aria-hidden", "false");
    });
}

if (qrRoomButton) {
    qrRoomButton.addEventListener("click", openQrModal);
}

function closeQrModal() {
    qrModal?.classList.add("hidden");
    qrModal?.setAttribute("aria-hidden", "true");
}

if (closeQrButton) closeQrButton.addEventListener("click", closeQrModal);

if (qrModal) {
    qrModal.addEventListener("click", (event) => {
        if (event.target === qrModal) closeQrModal();
    });
}

window.showTransferSection = function showTransferSection() {
    transferSection?.classList.remove("hidden");
};

if (fileInput) {
    fileInput.addEventListener("change", () => {
        const files = Array.from(fileInput.files || []);

        if (!selectedFiles) return;

        if (!files.length) {
            selectedFiles.textContent = "";
            return;
        }

        selectedFiles.textContent =
            files.length === 1
                ? `Selected: ${files[0].name}`
                : `${files.length} files selected`;
    });
}

if (dropZone && fileInput) {
    ["dragenter", "dragover"].forEach((eventName) => {
        dropZone.addEventListener(eventName, (event) => {
            event.preventDefault();
            dropZone.classList.add("dragover");
        });
    });

    ["dragleave", "drop"].forEach((eventName) => {
        dropZone.addEventListener(eventName, (event) => {
            event.preventDefault();
            dropZone.classList.remove("dragover");
        });
    });

    dropZone.addEventListener("drop", (event) => {
        const files = event.dataTransfer?.files;
        if (!files?.length) return;

        try {
            const dataTransfer = new DataTransfer();
            Array.from(files).forEach((file) => dataTransfer.items.add(file));
            fileInput.files = dataTransfer.files;
            fileInput.dispatchEvent(new Event("change", { bubbles: true }));
        } catch (error) {
            console.error("B2B: Could not load dropped files", error);
        }
    });
}

console.log("B2B: app.js loaded successfully");
