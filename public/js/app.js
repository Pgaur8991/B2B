const transferSection = document.getElementById("transfer-section");
const createRoomButton = document.getElementById("create-room-btn");
const joinRoomButton = document.getElementById("join-room-btn");
const roomCodeInput = document.getElementById("room-code-input");
const homeScreen = document.getElementById("home-screen");
const roomScreen = document.getElementById("room-screen");
const roomCodeDisplay = document.getElementById("room-code");
const connectionStatus = document.getElementById("connection-status");
const errorMessage = document.getElementById("error-message");
const copyRoomButton = document.getElementById("copy-room-btn");

// Make sure the required HTML elements exist before attaching listeners.
if (!createRoomButton || !joinRoomButton || !roomCodeInput || !homeScreen || !roomScreen) {
    console.error("B2B: Required UI elements are missing from index.html.");
}

// =========================
// CREATE ROOM
// =========================

if (createRoomButton) {
    createRoomButton.addEventListener("click", () => {
        clearError();
        console.log("B2B: Create Room clicked");

        if (typeof window.createRoom === "function") {
            window.createRoom();
        } else {
            showError("Signaling code is not loaded. Refresh the page.");
            console.error("B2B: createRoom() is not available.");
        }
    });
}

// =========================
// JOIN ROOM
// =========================

if (joinRoomButton) {
    joinRoomButton.addEventListener("click", () => {
        clearError();

        const roomCode = roomCodeInput.value.trim().toUpperCase();

        if (roomCode.length !== 6) {
            showError("Please enter a valid 6-character room code.");
            return;
        }

        if (typeof window.joinRoom === "function") {
            window.joinRoom(roomCode);
        } else {
            showError("Signaling code is not loaded. Refresh the page.");
            console.error("B2B: joinRoom() is not available.");
        }
    });
}

// =========================
// COPY ROOM CODE
// =========================

if (copyRoomButton) {
    copyRoomButton.addEventListener("click", async () => {
        const code = roomCodeDisplay.textContent.trim();

        try {
            await navigator.clipboard.writeText(code);
            copyRoomButton.textContent = "Copied!";

            setTimeout(() => {
                copyRoomButton.textContent = "Copy Room Code";
            }, 1500);
        } catch (error) {
            showError("Unable to copy room code.");
            console.error("B2B: Clipboard error", error);
        }
    });
}

// =========================
// SHOW ROOM
// =========================

window.showRoom = function showRoom(code) {
    console.log("B2B: Showing room", code);

    if (!homeScreen || !roomScreen || !roomCodeDisplay) {
        console.error("B2B: Room screen elements are missing.");
        return;
    }

    homeScreen.classList.add("hidden");
    roomScreen.classList.remove("hidden");
    roomCodeDisplay.textContent = code;
};

// =========================
// UPDATE CONNECTION STATUS
// =========================

window.updateStatus = function updateStatus(message) {
    if (connectionStatus) {
        connectionStatus.textContent = message;
    }
};

// =========================
// SHOW ERROR
// =========================

window.showError = function showError(message) {
    if (errorMessage) {
        errorMessage.textContent = message;
    }

    console.error("B2B:", message);
};

// =========================
// CLEAR ERROR
// =========================

window.clearError = function clearError() {
    if (errorMessage) {
        errorMessage.textContent = "";
    }
};

// =========================
// SHOW TRANSFER SECTION
// =========================

window.showTransferSection = function showTransferSection() {
    if (transferSection) {
        transferSection.classList.remove("hidden");
    }
};

console.log("B2B: app.js loaded successfully");
