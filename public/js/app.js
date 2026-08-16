const transferSection =
    document.getElementById("transfer-section");

const testMessageButton =
    document.getElementById("test-message-btn");

const receivedMessage =
    document.getElementById("received-message");

const createRoomButton =
    document.getElementById("create-room-btn");

const joinRoomButton =
    document.getElementById("join-room-btn");

const roomCodeInput =
    document.getElementById("room-code-input");

const homeScreen =
    document.getElementById("home-screen");

const roomScreen =
    document.getElementById("room-screen");

const roomCodeDisplay =
    document.getElementById("room-code");

const connectionStatus =
    document.getElementById("connection-status");

const errorMessage =
    document.getElementById("error-message");

const copyRoomButton =
    document.getElementById("copy-room-btn");


// Create room
createRoomButton.addEventListener("click", () => {

    clearError();

    createRoom();

});


// Join room
joinRoomButton.addEventListener("click", () => {

    clearError();

    const roomCode = roomCodeInput.value.trim();

    if (roomCode.length !== 6) {

        showError("Please enter a valid 6-character room code.");

        return;
    }

    joinRoom(roomCode);

});


// Copy room code
copyRoomButton.addEventListener("click", async () => {

    const code = roomCodeDisplay.textContent;

    await navigator.clipboard.writeText(code);

    copyRoomButton.textContent = "Copied!";

    setTimeout(() => {

        copyRoomButton.textContent = "Copy Room Code";

    }, 1500);

});


// Show room
function showRoom(code) {

    homeScreen.classList.add("hidden");

    roomScreen.classList.remove("hidden");

    roomCodeDisplay.textContent = code;

}


// Update connection status
function updateStatus(message) {

    connectionStatus.textContent = message;

}


// Show error
function showError(message) {

    errorMessage.textContent = message;

}


// Clear error
function clearError() {

    errorMessage.textContent = "";

}

// Display received message
function displayReceivedMessage(message) {
    receivedMessage.textContent = `Received: ${message}`;
}

testMessageButton.addEventListener("click", () => {

    sendTestMessage();

});

function showTransferSection() {

    transferSection.classList.remove("hidden");
}

function displayReceivedMessage(message) {
    receivedMessage.textContent = 
    `Received: ${message}`;
}
