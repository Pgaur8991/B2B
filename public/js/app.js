const appTransferSection = document.getElementById("transfer-section");
const appCreateRoomButton = document.getElementById("create-room-btn");
const appJoinRoomButton = document.getElementById("join-room-btn");
const appRoomCodeInput = document.getElementById("room-code-input");
const appHomeScreen = document.getElementById("home-screen");
const appRoomScreen = document.getElementById("room-screen");
const appRoomCodeDisplay = document.getElementById("room-code");
const appConnectionStatus = document.getElementById("connection-status");
const appRoomStatusText = document.getElementById("room-status-text");
const appErrorMessage = document.getElementById("error-message");
const appCopyRoomButton = document.getElementById("copy-room-btn");
const appQrRoomButton = document.getElementById("qr-room-btn");
const appQrModal = document.getElementById("qr-modal");
const appQrCanvas = document.getElementById("qr-canvas");
const appQrRoomCode = document.getElementById("qr-room-code");
const appQrLoading = document.getElementById("qr-loading");
const appCloseQrButton = document.getElementById("close-qr-btn");
const appToastContainer = document.getElementById("toast-container");
const appFileInput = document.getElementById("file-input");
const appSelectedFiles = document.getElementById("selected-files");
const appDropZone = document.getElementById("drop-zone");

function clearError() {
    if (appErrorMessage) appErrorMessage.textContent = "";
}

function showError(message) {
    if (appErrorMessage) appErrorMessage.textContent = message;
    console.error("B2B:", message);
}

window.clearError = clearError;
window.showError = showError;

window.showToast = function showToast(type, message) {
    if (!appToastContainer) return;

    const toast = document.createElement("div");
    toast.className = `toast ${type || ""}`;
    toast.textContent = message;
    appToastContainer.appendChild(toast);

    setTimeout(() => {
        toast.remove();
    }, 3200);
};

if (appCreateRoomButton) {
    appCreateRoomButton.addEventListener("click", () => {
        clearError();
        console.log("B2B: Create Room clicked");

        if (typeof window.createRoom === "function") {
            window.createRoom();
        } else {
            showError("Signaling code is not loaded. Refresh the page.");
        }
    });
}

if (appJoinRoomButton) {
    appJoinRoomButton.addEventListener("click", () => {
        clearError();

        const roomCode = appRoomCodeInput?.value.trim().toUpperCase() || "";

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

    if (!appHomeScreen || !appRoomScreen || !appRoomCodeDisplay) {
        showError("Room screen UI is missing. Please refresh the page.");
        return;
    }

    appHomeScreen.classList.add("hidden");
    appRoomScreen.classList.remove("hidden");
    appRoomCodeDisplay.textContent = code;

    if (appRoomStatusText) {
        appRoomStatusText.textContent = "Waiting for another browser...";
    }
};

window.updateStatus = function updateStatus(message) {
    if (appConnectionStatus) appConnectionStatus.textContent = message;

    if (appRoomStatusText && message.includes("P2P connection")) {
        appRoomStatusText.textContent = message;
    }
};

if (appCopyRoomButton) {
    appCopyRoomButton.addEventListener("click", async () => {
        const code = appRoomCodeDisplay?.textContent.trim() || "";
        if (!code || code === "------") return;

        try {
            await navigator.clipboard.writeText(code);
            const label = appCopyRoomButton.querySelector(".copy-label");
            if (label) label.textContent = "Copied";
            window.showToast("success", "Room code copied");

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
    const code = appRoomCodeDisplay?.textContent.trim() || "";
    if (!code || code === "------") return;

    if (!window.QRCode) {
        showError("QR code library did not load. You can still copy the room code.");
        return;
    }

    appQrRoomCode.textContent = code;
    appQrCanvas.classList.add("hidden");
    appQrLoading?.classList.remove("hidden");
    appQrModal?.classList.remove("hidden");
    appQrModal?.setAttribute("aria-hidden", "false");

    window.QRCode.toCanvas(appQrCanvas, code, {
        width: 220,
        margin: 2,
        errorCorrectionLevel: "M"
    }, (error) => {
        if (error) {
            console.error("B2B: QR error", error);
            appQrModal?.classList.add("hidden");
            appQrModal?.setAttribute("aria-hidden", "true");
            showError("Could not create the QR code.");
            return;
        }

        appQrLoading?.classList.add("hidden");
        appQrCanvas.classList.remove("hidden");
    });
}

if (appQrRoomButton) appQrRoomButton.addEventListener("click", openQrModal);

function closeQrModal() {
    appQrModal?.classList.add("hidden");
    appQrModal?.setAttribute("aria-hidden", "true");
}

if (appCloseQrButton) appCloseQrButton.addEventListener("click", closeQrModal);

if (appQrModal) {
    appQrModal.addEventListener("click", (event) => {
        if (event.target === appQrModal) closeQrModal();
    });
}

window.showTransferSection = function showTransferSection() {
    appTransferSection?.classList.remove("hidden");
};

if (appFileInput) {
    appFileInput.addEventListener("change", () => {
        const files = Array.from(appFileInput.files || []);
        if (!appSelectedFiles) return;

        if (!files.length) {
            appSelectedFiles.innerHTML = "";
            return;
        }

        appSelectedFiles.textContent = files.length === 1
            ? `Selected: ${files[0].name}`
            : `${files.length} files selected`;
    });
}

if (appDropZone && appFileInput) {
    ["dragenter", "dragover"].forEach((eventName) => {
        appDropZone.addEventListener(eventName, (event) => {
            event.preventDefault();
            appDropZone.classList.add("dragover");
        });
    });

    ["dragleave", "drop"].forEach((eventName) => {
        appDropZone.addEventListener(eventName, (event) => {
            event.preventDefault();
            appDropZone.classList.remove("dragover");
        });
    });

    appDropZone.addEventListener("drop", (event) => {
        const files = event.dataTransfer?.files;
        if (!files?.length) return;

        try {
            const dataTransfer = new DataTransfer();
            Array.from(files).forEach((file) => dataTransfer.items.add(file));
            appFileInput.files = dataTransfer.files;
            appFileInput.dispatchEvent(new Event("change", { bubbles: true }));
        } catch (error) {
            console.error("B2B: Could not load dropped files", error);
        }
    });
}

console.log("B2B: app.js loaded successfully");
