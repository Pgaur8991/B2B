let peerConnection = null;
let dataChannel = null;
let isInitiator = false;
let disconnectGraceTimer = null;

const rtcConfiguration = {
    iceServers: [
        {
            urls: "stun:stun.l.google.com:19302"
        }
    ]
};

const DATA_LOW_WATER = 1 * 1024 * 1024;

function clearDisconnectGraceTimer() {
    if (disconnectGraceTimer !== null) {
        clearTimeout(disconnectGraceTimer);
        disconnectGraceTimer = null;
    }
}

function scheduleDisconnectGraceFailure() {
    clearDisconnectGraceTimer();

    // WebRTC's disconnected state can be transient. Do not kill an active
    // transfer immediately just because ICE briefly loses connectivity.
    disconnectGraceTimer = setTimeout(() => {
        disconnectGraceTimer = null;

        if (
            peerConnection &&
            (peerConnection.connectionState === "failed" ||
                peerConnection.connectionState === "closed")
        ) {
            if (typeof failOutgoingTransfer === "function") {
                failOutgoingTransfer("Peer connection was lost during the transfer.");
            }
            if (typeof handleIncomingTransferDisconnect === "function") {
                handleIncomingTransferDisconnect();
            }
        }
    }, 15000);
}

function createPeerConnection() {
    console.log("Creating RTCPeerConnection...");

    clearDisconnectGraceTimer();
    peerConnection = new RTCPeerConnection(rtcConfiguration);

    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit("ice-candidate", event.candidate);
        }
    };

    peerConnection.onconnectionstatechange = () => {
        const state = peerConnection.connectionState;
        console.log("Connection state:", state);

        if (state === "connected") {
            clearDisconnectGraceTimer();
            updateStatus("🟢 P2P connection established!");
            return;
        }

        if (state === "connecting" || state === "new") {
            updateStatus("🟡 Connecting to peer...");
            return;
        }

        if (state === "disconnected") {
            updateStatus("🟡 Connection interrupted — waiting for recovery...");
            scheduleDisconnectGraceFailure();
            return;
        }

        if (state === "failed") {
            clearDisconnectGraceTimer();
            updateStatus("🔴 WebRTC connection failed.");
            if (typeof failOutgoingTransfer === "function") {
                failOutgoingTransfer("P2P connection failed during the transfer.");
            }
            if (typeof handleIncomingTransferDisconnect === "function") {
                handleIncomingTransferDisconnect();
            }
            return;
        }

        if (state === "closed") {
            clearDisconnectGraceTimer();
            if (typeof failOutgoingTransfer === "function") {
                failOutgoingTransfer("P2P connection closed.");
            }
            if (typeof handleIncomingTransferDisconnect === "function") {
                handleIncomingTransferDisconnect();
            }
        }
    };

    peerConnection.oniceconnectionstatechange = () => {
        const state = peerConnection.iceConnectionState;
        console.log("ICE state:", state);

        if (state === "connected" || state === "completed") {
            clearDisconnectGraceTimer();
        } else if (state === "disconnected") {
            scheduleDisconnectGraceFailure();
        } else if (state === "failed" || state === "closed") {
            clearDisconnectGraceTimer();
        }
    };

    peerConnection.ondatachannel = (event) => {
        console.log("DataChannel received.");
        dataChannel = event.channel;
        setupDataChannel();
    };
}

async function createOffer() {
    console.log("Creating WebRTC offer...");

    isInitiator = true;
    createPeerConnection();

    dataChannel = peerConnection.createDataChannel("b2b-transfer", {
        ordered: true,
        maxRetransmits: null
    });
    setupDataChannel();

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    socket.emit("offer", peerConnection.localDescription);
}

async function handleOffer(offer) {
    console.log("Received WebRTC offer.");

    if (!peerConnection) {
        createPeerConnection();
    }

    await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));

    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    socket.emit("answer", peerConnection.localDescription);
}

async function handleAnswer(answer) {
    console.log("Received WebRTC answer.");
    await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
}

async function handleIceCandidate(candidate) {
    try {
        if (peerConnection) {
            await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
        }
    } catch (error) {
        console.error("Error adding ICE candidate:", error);
    }
}

function getMaxDataChannelMessageSize() {
    const negotiated = Number(peerConnection?.sctp?.maxMessageSize);
    if (!Number.isFinite(negotiated) || negotiated <= 0) return 256 * 1024;
    return negotiated;
}

function getRecommendedTransferChunkSize() {
    const maxMessageSize = getMaxDataChannelMessageSize();

    if (maxMessageSize >= 256 * 1024) return 256 * 1024;
    if (maxMessageSize >= 128 * 1024) return 128 * 1024;
    return 64 * 1024;
}

function configureDataChannelPerformance(channel) {
    if (!channel) return;

    channel.bufferedAmountLowThreshold = DATA_LOW_WATER;

    console.log(`DataChannel max message size: ${getMaxDataChannelMessageSize()} bytes`);
    console.log(`B2B transfer chunk size: ${getRecommendedTransferChunkSize()} bytes`);
    console.log(`B2B send low-water mark: ${DATA_LOW_WATER} bytes`);
}

function setupDataChannel() {
    dataChannel.binaryType = "arraybuffer";
    configureDataChannelPerformance(dataChannel);

    dataChannel.onopen = () => {
        console.log("🎉 DataChannel OPEN!");
        clearDisconnectGraceTimer();

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
    if (!dataChannel || dataChannel.readyState !== "open") {
        console.error("DataChannel is not open.");
        return;
    }

    dataChannel.send("Hello from B2B!🚀");
}
