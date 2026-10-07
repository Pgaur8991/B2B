const socket = io();

// Make Socket.IO available to the other frontend files.
window.socket = socket;

// =========================
// SOCKET CONNECTION STATUS
// =========================

socket.on("connect", () => {
    console.log("Connected to signaling server:", socket.id);

    if (typeof window.updateStatus === "function") {
        window.updateStatus("Connected to signaling server");
    }
});

socket.on("disconnect", () => {
    console.log("Disconnected from signaling server");

    if (typeof window.updateStatus === "function") {
        window.updateStatus("Disconnected from signaling server");
    }
});

// =========================
// CREATE ROOM
// =========================

window.createRoom = function createRoom() {
    console.log("B2B: Sending create-room to server");
    socket.emit("create-room");
};

// =========================
// JOIN ROOM
// =========================

window.joinRoom = function joinRoom(roomCode) {
    console.log("B2B: Sending join-room:", roomCode);
    socket.emit("join-room", roomCode);
};

// =========================
// ROOM CREATED
// =========================

socket.on("room-created", (data) => {
    console.log("Room created:", data.roomCode);

    if (typeof window.showRoom === "function") {
        window.showRoom(data.roomCode);
    } else {
        console.error("B2B: showRoom() is not available.");
    }

    if (typeof window.updateStatus === "function") {
        window.updateStatus("Waiting for another browser...");
    }
});

// =========================
// ROOM JOINED
// =========================

socket.on("room-joined", (data) => {
    console.log("Joined room:", data.roomCode);

    if (typeof window.showRoom === "function") {
        window.showRoom(data.roomCode);
    }

    if (typeof window.updateStatus === "function") {
        window.updateStatus("Joined room. Connecting to peer...");
    }
});

// =========================
// PEER JOINED
// =========================

socket.on("peer-joined", async () => {
    console.log("Another browser joined!");

    if (typeof window.updateStatus === "function") {
        window.updateStatus("🟡 Peer joined. Establishing P2P connection...");
    }

    if (typeof createOffer === "function") {
        await createOffer();
    } else {
        console.error("B2B: createOffer() is not available.");
    }
});

// =========================
// RECEIVE OFFER
// =========================

socket.on("offer", async (offer) => {
    console.log("WebRTC offer received.");

    if (typeof handleOffer === "function") {
        await handleOffer(offer);
    }
});

// =========================
// RECEIVE ANSWER
// =========================

socket.on("answer", async (answer) => {
    console.log("WebRTC answer received.");

    if (typeof handleAnswer === "function") {
        await handleAnswer(answer);
    }
});

// =========================
// RECEIVE ICE
// =========================

socket.on("ice-candidate", async (candidate) => {
    console.log("ICE candidate received.");

    if (typeof handleIceCandidate === "function") {
        await handleIceCandidate(candidate);
    }
});

// =========================
// JOIN ERROR
// =========================

socket.on("join-error", (data) => {
    if (typeof window.showError === "function") {
        window.showError(data.message);
    }
});

// =========================
// PEER LEFT
// =========================

socket.on("peer-left", () => {
    if (typeof window.updateStatus === "function") {
        window.updateStatus("🔴 The other browser disconnected.");
    }
});

console.log("B2B: signaling.js loaded successfully");
