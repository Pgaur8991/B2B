const express = require("express");
const path = require("path");
const http = require("http");
const os = require("os");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = 3000;

// Serve frontend
app.use(express.static(path.join(__dirname, "../public")));

// Build a URL that another device on the same network can open.
// This makes QR codes generated from localhost usable on a phone.
function getLanAddress() {
    const interfaces = os.networkInterfaces();

    for (const entries of Object.values(interfaces)) {
        for (const entry of entries || []) {
            if (entry.family === "IPv4" && !entry.internal) {
                return entry.address;
            }
        }
    }

    return null;
}

app.get("/join-url", (req, res) => {
    const roomCode = String(req.query.room || "").trim().toUpperCase();

    if (!/^[A-Z0-9]{6}$/.test(roomCode)) {
        return res.status(400).json({ message: "Invalid room code." });
    }

    const forwardedProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
    const protocol = forwardedProto || req.protocol || "http";
    let host = req.get("host");

    const hostname = req.hostname;
    const isLocalHost = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";

    if (isLocalHost) {
        const lanAddress = getLanAddress();
        if (lanAddress) {
            host = `${lanAddress}:${PORT}`;
        }
    }

    const url = `${protocol}://${host}/?room=${encodeURIComponent(roomCode)}`;
    res.json({ url });
});

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

    socket.on("create-room", () => {
        let roomCode = generateRoomCode();

        while (io.sockets.adapter.rooms.has(roomCode)) {
            roomCode = generateRoomCode();
        }

        socket.join(roomCode);
        socket.roomCode = roomCode;

        console.log(`Room created: ${roomCode}`);
        socket.emit("room-created", { roomCode });
    });

    socket.on("join-room", (roomCode) => {
        roomCode = roomCode.toUpperCase().trim();
        const room = io.sockets.adapter.rooms.get(roomCode);

        if (!room) {
            socket.emit("join-error", { message: "Room does not exist." });
            return;
        }

        if (room.size >= 2) {
            socket.emit("join-error", { message: "Room is already full." });
            return;
        }

        socket.join(roomCode);
        socket.roomCode = roomCode;

        console.log(`Client ${socket.id} joined room ${roomCode}`);
        socket.emit("room-joined", { roomCode });
        socket.to(roomCode).emit("peer-joined");
    });

    socket.on("offer", (offer) => {
        console.log(`Forwarding offer from ${socket.id}`);
        socket.to(socket.roomCode).emit("offer", offer);
    });

    socket.on("answer", (answer) => {
        console.log(`Forwarding answer from ${socket.id}`);
        socket.to(socket.roomCode).emit("answer", answer);
    });

    socket.on("ice-candidate", (candidate) => {
        socket.to(socket.roomCode).emit("ice-candidate", candidate);
    });

    socket.on("disconnect", () => {
        console.log("Client disconnected:", socket.id);

        if (socket.roomCode) {
            socket.to(socket.roomCode).emit("peer-left");
        }
    });
});

server.listen(PORT, "0.0.0.0", () => {
    console.log(`B2B server running at http://localhost:${PORT}`);
});
