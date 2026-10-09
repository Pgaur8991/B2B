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
            if (typeof failOutgoingTransfer === "function") {
                failOutgoingTransfer("Peer disconnected during the transfer.");
            }
            if (typeof handleIncomingTransferDisconnect === "function") {
                handleIncomingTransferDisconnect();
            }
        }

        if (peerConnection.connectionState === "failed") {
            updateStatus("🔴 WebRTC connection failed.");
            if (typeof failOutgoingTransfer === "function") {
                failOutgoingTransfer("P2P connection failed during the transfer.");
            }
            if (typeof handleIncomingTransferDisconnect === "function") {
                handleIncomingTransferDisconnect();
            }
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
// DATA CHANNEL PERFORMANCE
// =========================

function optimizeDataChannel(channel) {
    if (!channel || channel.__b2bOptimized) return;

    channel.__b2bOptimized = true;
    channel.bufferedAmountLowThreshold = 2 * 1024 * 1024;

    const negotiatedMax = Number(peerConnection?.sctp?.maxMessageSize) || 65536;
    const maxMessageSize = negotiatedMax === 0 ? 256 * 1024 : negotiatedMax;

    // transfer.js currently produces 64 KB chunks. If the browsers negotiated
    // a larger SCTP message size, combine those chunks to reduce message overhead.
    const targetSize =
        maxMessageSize >= 256 * 1024 ? 256 * 1024 :
        maxMessageSize >= 128 * 1024 ? 128 * 1024 :
        64 * 1024;

    console.log(`DataChannel max message size: ${negotiatedMax} bytes`);
    console.log(`B2B transfer aggregation target: ${targetSize} bytes`);

    // If the negotiated limit is only 64 KB, keep the existing safe behavior.
    if (targetSize <= 64 * 1024) return;

    const originalSend = channel.send.bind(channel);
    let pendingChunks = [];
    let pendingBytes = 0;
    let flushTimer = null;

    const clearPending = () => {
        pendingChunks = [];
        pendingBytes = 0;
        if (flushTimer !== null) {
            clearTimeout(flushTimer);
            flushTimer = null;
        }
    };

    const flushPending = () => {
        if (!pendingBytes) return;

        if (channel.readyState !== "open") {
            clearPending();
            return;
        }

        const merged = new Uint8Array(pendingBytes);
        let offset = 0;

        for (const chunk of pendingChunks) {
            merged.set(chunk, offset);
            offset += chunk.byteLength;
        }

        clearPending();
        originalSend(merged.buffer);
    };

    const scheduleFlush = () => {
        if (flushTimer !== null) return;
        flushTimer = setTimeout(() => {
            flushTimer = null;
            flushPending();
        }, 6);
    };

    channel.send = (payload) => {
        // File data is sent by transfer.js as ArrayBuffer chunks. Control
        // messages are flushed separately so their JSON boundaries remain intact.
        if (payload instanceof ArrayBuffer && payload.byteLength <= 64 * 1024) {
            pendingChunks.push(new Uint8Array(payload));
            pendingBytes += payload.byteLength;

            if (pendingBytes >= targetSize) {
                flushPending();
            } else {
                scheduleFlush();
            }
            return;
        }

        flushPending();
        return originalSend(payload);
    };

    channel.addEventListener("close", clearPending, { once: true });
}


// =========================
// DATA CHANNEL
// =========================

function setupDataChannel() {
    dataChannel.binaryType = "arraybuffer";
    optimizeDataChannel(dataChannel);

    dataChannel.onopen = () => {
        console.log("🎉 DataChannel OPEN!");

        if (typeof resetOutgoingTransferState === "function") {
            resetOutgoingTransferState();
        }

        updateStatus("🟢 Direct P2P connection ready!");
        showTransferSection();
    };

    dataChannel.onclose = () => {
        console.log("DataChannel closed.");
        updateStatus("🟡 P2P connection closed.");

        if (typeof failOutgoingTransfer === "function") {
            failOutgoingTransfer("Peer disconnected during the transfer.");
        }

        if (typeof handleIncomingTransferDisconnect === "function") {
            handleIncomingTransferDisconnect();
        }
    };

    dataChannel.onerror = (error) => {
        console.error("DataChannel error:", error);
        updateStatus("🔴 P2P data channel error.");

        if (typeof failOutgoingTransfer === "function") {
            failOutgoingTransfer("P2P data channel error during the transfer.");
        }
    };

    dataChannel.onmessage = (event) => {
        // Avoid logging every binary chunk; that can noticeably hurt mobile performance.
        if (typeof event.data === "string") {
            console.log("Data received:", event.data);
        }

        if (typeof enqueueIncomingMessage === "function") {
            enqueueIncomingMessage(event.data);
        } else if (typeof handleIncomingTransferMessage === "function") {
            handleIncomingTransferMessage(event.data);
        }

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
