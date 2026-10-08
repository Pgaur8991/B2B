let peerConnection = null;
let dataChannel = null;

let isInitiator = false;


// STUN server
const rtcConfiguration = {
    iceServers: [
        {
            urls: "stun:stun.l.google.com:19302"
        }
    ]
};


// =========================
// CREATE PEER CONNECTION
// =========================

function createPeerConnection() {
    console.log("Creating RTCPeerConnection...");

    peerConnection = new RTCPeerConnection(rtcConfiguration);

    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            console.log("Sending ICE candidate");
            socket.emit("ice-candidate", event.candidate);
        }
    };

    peerConnection.onconnectionstatechange = () => {
        console.log("Connection state:", peerConnection.connectionState);

        if (peerConnection.connectionState === "connected") {
            updateStatus("🟢 P2P connection established!");
        }

        if (peerConnection.connectionState === "disconnected") {
            updateStatus("🟡 Peer disconnected.");
        }

        if (peerConnection.connectionState === "failed") {
            updateStatus("🔴 WebRTC connection failed.");
        }
    };

    peerConnection.oniceconnectionstatechange = () => {
        console.log("ICE state:", peerConnection.iceConnectionState);
    };

    peerConnection.ondatachannel = (event) => {
        console.log("DataChannel received.");

        dataChannel = event.channel;
        setupDataChannel();
    };
}


// =========================
// CREATE OFFER
// =========================

async function createOffer() {
    console.log("Creating WebRTC offer...");

    isInitiator = true;
    createPeerConnection();

    dataChannel = peerConnection.createDataChannel("b2b-transfer");
    setupDataChannel();

    const offer = await peerConnection.createOffer();

    await peerConnection.setLocalDescription(offer);

    console.log("Sending offer to peer...");

    socket.emit("offer", peerConnection.localDescription);
}


// =========================
// RECEIVE OFFER
// =========================

async function handleOffer(offer) {
    console.log("Received WebRTC offer.");

    if (!peerConnection) {
        createPeerConnection();
    }

    await peerConnection.setRemoteDescription(
        new RTCSessionDescription(offer)
    );

    const answer = await peerConnection.createAnswer();

    await peerConnection.setLocalDescription(answer);

    console.log("Sending answer to peer...");

    socket.emit("answer", peerConnection.localDescription);
}


// =========================
// RECEIVE ANSWER
// =========================

async function handleAnswer(answer) {
    console.log("Received WebRTC answer.");

    await peerConnection.setRemoteDescription(
        new RTCSessionDescription(answer)
    );
}


// =========================
// RECEIVE ICE
// =========================

async function handleIceCandidate(candidate) {
    try {
        if (peerConnection) {
            await peerConnection.addIceCandidate(
                new RTCIceCandidate(candidate)
            );
        }
    } catch (error) {
        console.error("Error adding ICE candidate:", error);
    }
}


// =========================
// DATA CHANNEL
// =========================

function setupDataChannel() {
    dataChannel.binaryType = "arraybuffer";

    dataChannel.onopen = () => {
        console.log("🎉 DataChannel OPEN!");

        updateStatus("🟢 Direct P2P connection ready!");
        showTransferSection();
    };

    dataChannel.onclose = () => {
        console.log("DataChannel closed.");
        updateStatus("🟡 P2P connection closed.");
    };

    dataChannel.onerror = (error) => {
        console.error("DataChannel error:", error);
        updateStatus("🔴 P2P data channel error.");
    };

    dataChannel.onmessage = (event) => {
        console.log("Data received:", event.data);

        // transfer.js serializes messages so file chunks and FILE_END
        // cannot race each other while async disk writes are pending.
        if (typeof enqueueIncomingMessage === "function") {
            enqueueIncomingMessage(event.data);
        } else if (typeof handleIncomingTransferMessage === "function") {
            handleIncomingTransferMessage(event.data);
        }

        // Keep the old test-message display.
        if (
            typeof event.data === "string" &&
            !event.data.startsWith("{") &&
            typeof displayReceivedMessage === "function"
        ) {
            displayReceivedMessage(event.data);
        }
    };
}


function sendTestMessage() {
    if (!dataChannel) {
        console.error("DataChannel does not exist.");
        return;
    }

    if (dataChannel.readyState !== "open") {
        console.error("DataChannel is not open.");
        return;
    }

    const message = "Hello from B2B!🚀";

    console.log("Sending:", message);
    dataChannel.send(message);
}
