const express = require("express");
const path = require("path");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = 3000;

// Serve frontend
app.use(express.static(path.join(__dirname, "../public")));


// Generate a 6-character room code
function generateRoomCode() {

    const characters = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

    let code = "";

    for (let i = 0; i < 6; i++) {

        code += characters.charAt(
            Math.floor(Math.random() * characters.length)
        );

    }

    return code;
}


// Socket.IO
io.on("connection", (socket) => {

    console.log("Client connected:", socket.id);


    // =========================
    // CREATE ROOM
    // =========================

    socket.on("create-room", () => {

        let roomCode = generateRoomCode();

        while (io.sockets.adapter.rooms.has(roomCode)) {

            roomCode = generateRoomCode();

        }

        socket.join(roomCode);

        socket.roomCode = roomCode;

        console.log(`Room created: ${roomCode}`);

        socket.emit("room-created", {
            roomCode: roomCode
        });

    });


    // =========================
    // JOIN ROOM
    // =========================

    socket.on("join-room", (roomCode) => {

        roomCode = roomCode.toUpperCase().trim();

        const room = io.sockets.adapter.rooms.get(roomCode);


        if (!room) {

            socket.emit("join-error", {
                message: "Room does not exist."
            });

            return;

        }


        if (room.size >= 2) {

            socket.emit("join-error", {
                message: "Room is already full."
            });

            return;

        }


        socket.join(roomCode);

        socket.roomCode = roomCode;

        console.log(
            `Client ${socket.id} joined room ${roomCode}`
        );


        socket.emit("room-joined", {
            roomCode: roomCode
        });


        // Tell creator that peer joined
        socket.to(roomCode).emit("peer-joined");

    });


    // =========================
    // WEBRTC OFFER
    // =========================

    socket.on("offer", (offer) => {

        console.log(`Forwarding offer from ${socket.id}`);

        socket.to(socket.roomCode).emit("offer", offer);

    });


    // =========================
    // WEBRTC ANSWER
    // =========================

    socket.on("answer", (answer) => {

        console.log(`Forwarding answer from ${socket.id}`);

        socket.to(socket.roomCode).emit("answer", answer);

    });


    // =========================
    // ICE CANDIDATE
    // =========================

    socket.on("ice-candidate", (candidate) => {

        socket.to(socket.roomCode).emit(
            "ice-candidate",
            candidate
        );

    });


    // =========================
    // DISCONNECT
    // =========================

    socket.on("disconnect", () => {

        console.log(
            "Client disconnected:",
            socket.id
        );


        if (socket.roomCode) {

            socket.to(socket.roomCode).emit("peer-left");

        }

    });

});


// =========================
// START SERVER
// =========================

server.listen(PORT, () => {

    console.log(
        `B2B server running at http://localhost:${PORT}`
    );

});