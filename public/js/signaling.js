const socket = io();

console.log(
    "Connected to signaling server"
);


// =========================
// CREATE ROOM
// =========================

function createRoom() {

    socket.emit("create-room");

}


// =========================
// JOIN ROOM
// =========================

function joinRoom(roomCode) {

    socket.emit(
        "join-room",
        roomCode
    );

}


// =========================
// ROOM CREATED
// =========================

socket.on("room-created", (data) => {

    console.log(
        "Room created:",
        data.roomCode
    );


    showRoom(data.roomCode);


    updateStatus(
        "Waiting for another browser..."
    );

});


// =========================
// ROOM JOINED
// =========================

socket.on("room-joined", (data) => {

    console.log(
        "Joined room:",
        data.roomCode
    );


    showRoom(data.roomCode);


    updateStatus(
        "Joined room. Connecting to peer..."
    );

});


// =========================
// PEER JOINED
// =========================

socket.on("peer-joined", async () => {

    console.log(
        "Another browser joined!"
    );


    updateStatus(
        "🟡 Peer joined. Establishing P2P connection..."
    );


    // Creator becomes WebRTC initiator
    await createOffer();

});


// =========================
// RECEIVE OFFER
// =========================

socket.on("offer", async (offer) => {

    console.log(
        "WebRTC offer received."
    );


    await handleOffer(offer);

});


// =========================
// RECEIVE ANSWER
// =========================

socket.on("answer", async (answer) => {

    console.log(
        "WebRTC answer received."
    );


    await handleAnswer(answer);

});


// =========================
// RECEIVE ICE
// =========================

socket.on("ice-candidate", async (candidate) => {

    console.log(
        "ICE candidate received."
    );


    await handleIceCandidate(candidate);

});


// =========================
// JOIN ERROR
// =========================

socket.on("join-error", (data) => {

    showError(
        data.message
    );

});


// =========================
// PEER LEFT
// =========================

socket.on("peer-left", () => {

    updateStatus(
        "🔴 The other browser disconnected."
    );

});