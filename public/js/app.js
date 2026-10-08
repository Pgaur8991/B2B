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
    setTimeout(() => toast.remove(), 3200);
};

if (appCreateRoomButton) {
    appCreateRoomButton.addEventListener("click", () => {
        clearError();
        if (typeof window.createRoom === "function") window.createRoom();
        else showError("Signaling code is not loaded. Refresh the page.");
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
        if (typeof window.joinRoom === "function") window.joinRoom(roomCode);
        else showError("Signaling code is not loaded. Refresh the page.");
    });
}

window.showRoom = function showRoom(code) {
    if (!appHomeScreen || !appRoomScreen || !appRoomCodeDisplay) {
        showError("Room screen UI is missing. Please refresh the page.");
        return;
    }
    appHomeScreen.classList.add("hidden");
    appRoomScreen.classList.remove("hidden");
    appRoomCodeDisplay.textContent = code;
    if (appRoomStatusText) appRoomStatusText.textContent = "Waiting for another browser...";
};

window.updateStatus = function updateStatus(message) {
    if (appConnectionStatus) appConnectionStatus.textContent = message;
    if (appRoomStatusText && message.includes("P2P connection")) appRoomStatusText.textContent = message;
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
            setTimeout(() => { if (label) label.textContent = "Copy"; }, 1500);
        } catch (error) {
            showError("Unable to copy room code.");
        }
    });
}

function showQrImage(url) {
    let image = document.getElementById("qr-image");
    if (!image) {
        image = document.createElement("img");
        image.id = "qr-image";
        image.width = 220;
        image.height = 220;
        image.alt = "Room QR code";
        image.style.display = "block";
        image.style.margin = "0 auto";
        appQrCanvas?.classList.add("hidden");
        appQrCanvas?.insertAdjacentElement("afterend", image);
    }
    image.src = url;
    image.classList.remove("hidden");
    appQrLoading?.classList.add("hidden");
}

function openQrModal() {
    const code = appRoomCodeDisplay?.textContent.trim() || "";
    if (!code || code === "------") return;

    appQrRoomCode.textContent = code;
    appQrCanvas?.classList.add("hidden");
    appQrLoading?.classList.remove("hidden");
    appQrModal?.classList.remove("hidden");
    appQrModal?.setAttribute("aria-hidden", "false");

    const existingImage = document.getElementById("qr-image");
    existingImage?.classList.add("hidden");

    if (window.QRCode?.toCanvas) {
        window.QRCode.toCanvas(appQrCanvas, code, {
            width: 220,
            margin: 2,
            errorCorrectionLevel: "M"
        }, (error) => {
            if (error) {
                console.warn("B2B: local QR generation failed, using fallback.", error);
                showQrImage(`https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(code)}`);
                return;
            }
            appQrLoading?.classList.add("hidden");
            appQrCanvas?.classList.remove("hidden");
        });
        return;
    }

    // Fallback for browsers/networks where the CDN QR library did not load.
    showQrImage(`https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(code)}`);
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
        if (typeof window.renderSelectedFiles === "function") window.renderSelectedFiles();
        else if (appSelectedFiles) appSelectedFiles.textContent = "";
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
