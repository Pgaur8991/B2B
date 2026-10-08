const appTransferSection = document.getElementById("transfer-section");
const appCreateRoomButton = document.getElementById("create-room-btn");
const appJoinRoomButton = document.getElementById("join-room-btn");
const appRoomCodeInput = document.getElementById("room-code-input");
const appScanConnectButton = document.getElementById("scan-connect-btn");
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

const scannerModal = document.getElementById("scanner-modal");
const scannerVideo = document.getElementById("scanner-video");
const scannerStatus = document.getElementById("scanner-status");
const startScannerButton = document.getElementById("start-scanner-btn");
const closeScannerButton = document.getElementById("close-scanner-btn");
const closeScannerActionButton = document.getElementById("close-scanner-action-btn");

let scannerStream = null;
let scannerRunning = false;
let scannerAnimationFrame = null;
let scannerCanvas = null;
let scannerCanvasContext = null;
let qrDetector = null;

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

function joinWithCode(roomCode) {
    const normalizedCode = String(roomCode || "").trim().toUpperCase();
    if (normalizedCode.length !== 6) {
        showError("Please enter a valid 6-character room code.");
        return false;
    }

    clearError();
    if (appRoomCodeInput) appRoomCodeInput.value = normalizedCode;

    if (typeof window.joinRoom === "function") {
        window.joinRoom(normalizedCode);
        return true;
    }

    showError("Signaling code is not loaded. Refresh the page.");
    return false;
}

if (appCreateRoomButton) {
    appCreateRoomButton.addEventListener("click", () => {
        clearError();
        if (typeof window.createRoom === "function") window.createRoom();
        else showError("Signaling code is not loaded. Refresh the page.");
    });
}

if (appJoinRoomButton) {
    appJoinRoomButton.addEventListener("click", () => {
        joinWithCode(appRoomCodeInput?.value || "");
    });
}

// Press Enter after pasting/typing a room code.
if (appRoomCodeInput) {
    appRoomCodeInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            event.preventDefault();
            joinWithCode(appRoomCodeInput.value);
        }
    });

    appRoomCodeInput.addEventListener("input", () => {
        appRoomCodeInput.value = appRoomCodeInput.value
            .replace(/[^a-zA-Z0-9]/g, "")
            .slice(0, 6)
            .toUpperCase();
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

async function getJoinUrl(code) {
    try {
        const response = await fetch(`/join-url?room=${encodeURIComponent(code)}`, {
            cache: "no-store"
        });
        if (response.ok) {
            const data = await response.json();
            if (data?.url) return data.url;
        }
    } catch (error) {
        console.warn("B2B: Could not get network join URL. Falling back to current page URL.", error);
    }

    const url = new URL(window.location.href);
    url.search = "";
    url.hash = "";
    url.searchParams.set("room", code);
    return url.toString();
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

async function openQrModal() {
    const code = appRoomCodeDisplay?.textContent.trim() || "";
    if (!code || code === "------") return;

    appQrRoomCode.textContent = code;
    appQrCanvas?.classList.add("hidden");
    appQrLoading?.classList.remove("hidden");
    appQrModal?.classList.remove("hidden");
    appQrModal?.setAttribute("aria-hidden", "false");

    const existingImage = document.getElementById("qr-image");
    existingImage?.classList.add("hidden");

    const joinUrl = await getJoinUrl(code);

    if (!appQrModal || appQrModal.classList.contains("hidden")) return;

    if (window.QRCode?.toCanvas) {
        window.QRCode.toCanvas(appQrCanvas, joinUrl, {
            width: 220,
            margin: 2,
            errorCorrectionLevel: "M"
        }, (error) => {
            if (error) {
                console.warn("B2B: local QR generation failed, using fallback.", error);
                showQrImage(`https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(joinUrl)}`);
                return;
            }
            appQrLoading?.classList.add("hidden");
            appQrCanvas?.classList.remove("hidden");
        });
        return;
    }

    showQrImage(`https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(joinUrl)}`);
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

function extractRoomCode(rawValue) {
    const value = String(rawValue || "").trim();
    if (!value) return null;

    try {
        const url = new URL(value);
        const code = url.searchParams.get("room");
        if (code) return code.trim().toUpperCase();
    } catch {
        // QR may contain the raw room code instead of a URL.
    }

    const match = value.match(/\b[A-Z0-9]{6}\b/i);
    return match ? match[0].toUpperCase() : null;
}

async function handleScannedValue(rawValue) {
    const code = extractRoomCode(rawValue);
    if (!code) {
        scannerStatus.textContent = "That QR code is not a valid B2B room code.";
        return;
    }

    stopScanner();
    closeScannerModal();
    window.showToast("success", `Room ${code} found. Joining...`);
    joinWithCode(code);
}

async function openScannerModal() {
    scannerModal?.classList.remove("hidden");
    scannerModal?.setAttribute("aria-hidden", "false");
    scannerStatus.textContent = "Point your camera at the room QR code.";
    await startScanner();
}

function closeScannerModal() {
    stopScanner();
    scannerModal?.classList.add("hidden");
    scannerModal?.setAttribute("aria-hidden", "true");
}

async function startScanner() {
    if (!navigator.mediaDevices?.getUserMedia) {
        scannerStatus.textContent = "Camera access is not available in this browser. Use the phone's normal camera app instead.";
        return;
    }

    if (!window.isSecureContext) {
        scannerStatus.textContent = "Camera scanning needs HTTPS. You can still use your phone's normal camera app to scan the B2B QR code.";
        return;
    }

    stopScanner();

    try {
        scannerStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: "environment" } },
            audio: false
        });

        scannerVideo.srcObject = scannerStream;
        await scannerVideo.play();
        scannerRunning = true;
        scannerStatus.textContent = "Scanning... point the camera at the QR code.";

        scannerCanvas = scannerCanvas || document.createElement("canvas");
        scannerCanvasContext = scannerCanvasContext || scannerCanvas.getContext("2d", { willReadFrequently: true });

        scanLoop();
    } catch (error) {
        console.error("B2B: Camera error", error);
        scannerStatus.textContent = error?.name === "NotAllowedError"
            ? "Camera permission was denied. Allow camera access and try again."
            : "Could not start the camera. Use the phone's normal camera app instead.";
    }
}

async function detectQrFromVideo() {
    if ("BarcodeDetector" in window) {
        try {
            if (!qrDetector) {
                const supported = typeof BarcodeDetector.getSupportedFormats === "function"
                    ? await BarcodeDetector.getSupportedFormats()
                    : ["qr_code"];

                if (supported.includes("qr_code")) {
                    qrDetector = new BarcodeDetector({ formats: ["qr_code"] });
                }
            }

            if (qrDetector) {
                const codes = await qrDetector.detect(scannerVideo);
                if (codes.length && codes[0].rawValue) return codes[0].rawValue;
            }
        } catch (error) {
            console.warn("B2B: BarcodeDetector unavailable, using jsQR fallback.");
            qrDetector = null;
        }
    }

    if (typeof window.jsQR === "function" && scannerCanvasContext) {
        const width = scannerVideo.videoWidth;
        const height = scannerVideo.videoHeight;
        const imageData = scannerCanvasContext.getImageData(0, 0, width, height);
        const result = window.jsQR(imageData.data, imageData.width, imageData.height, {
            inversionAttempts: "attemptBoth"
        });
        if (result?.data) return result.data;
    }

    return null;
}

async function scanLoop() {
    if (!scannerRunning) return;

    if (scannerVideo.readyState >= 2) {
        const width = scannerVideo.videoWidth;
        const height = scannerVideo.videoHeight;

        if (width && height) {
            scannerCanvas.width = width;
            scannerCanvas.height = height;
            scannerCanvasContext.drawImage(scannerVideo, 0, 0, width, height);

            try {
                const rawValue = await detectQrFromVideo();
                if (rawValue) {
                    await handleScannedValue(rawValue);
                    return;
                }
            } catch (error) {
                // Keep scanning. Browser camera/QR support varies by device.
            }
        }
    }

    scannerAnimationFrame = requestAnimationFrame(scanLoop);
}

function stopScanner() {
    scannerRunning = false;

    if (scannerAnimationFrame) {
        cancelAnimationFrame(scannerAnimationFrame);
        scannerAnimationFrame = null;
    }

    if (scannerStream) {
        scannerStream.getTracks().forEach((track) => track.stop());
        scannerStream = null;
    }

    if (scannerVideo) scannerVideo.srcObject = null;
    qrDetector = null;
}

if (appScanConnectButton) appScanConnectButton.addEventListener("click", openScannerModal);
if (startScannerButton) startScannerButton.addEventListener("click", startScanner);
if (closeScannerButton) closeScannerButton.addEventListener("click", closeScannerModal);
if (closeScannerActionButton) closeScannerActionButton.addEventListener("click", closeScannerModal);
if (scannerModal) {
    scannerModal.addEventListener("click", (event) => {
        if (event.target === scannerModal) closeScannerModal();
    });
}

// If a B2B QR URL was scanned by the phone's normal camera, the page opens
// with ?room=XXXXXX and joins automatically.
function autoJoinFromQrUrl() {
    const code = new URLSearchParams(window.location.search).get("room");
    if (!code) return;

    const normalizedCode = code.trim().toUpperCase();
    if (normalizedCode.length !== 6) return;

    if (appRoomCodeInput) appRoomCodeInput.value = normalizedCode;
    window.showToast("success", `Room ${normalizedCode} found. Joining...`);

    setTimeout(() => joinWithCode(normalizedCode), 250);
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

autoJoinFromQrUrl();
console.log("B2B: app.js loaded successfully");
