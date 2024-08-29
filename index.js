const express = require("express");
const app = express();
const http = require("http").createServer(app);
const io = require("socket.io")(http);
const PORT = process.env.PORT || 3001;
const path = require("path");

let socketList = {};
let breakoutRooms = {};
let viewers = {};

app.use(express.static(path.join(__dirname, "../vite")));

if (process.env.NODE_ENV === "production") {
  app.use(express.static(path.join(__dirname, "../client/build")));

  app.get("/*", function (req, res) {
    res.sendFile(path.join(__dirname, "../client/build/index.html"));
  });
}

app.get("/ping", (req, res) => {
  res.send({ success: true }).status(200);
});

io.on("connection", (socket) => {
  console.log(`New User connected: ${socket.id}`);

  socket.on("BE-join-as-viewer", ({ roomId, userName }) => {
    console.log('Viewer joining room:', roomId, userName);
    socket.join(roomId);
    viewers[socket.id] = { userName, roomId };
  
    const participants = Object.entries(socketList)
      .filter(([, user]) => user.roomId === roomId)
      .map(([userId, info]) => ({ userId, info }));
    
    // Notify the new viewer about existing participants
    socket.emit('FE-viewer-init', participants);
  
    // Notify all participants in the room about the new viewer
    socket.to(roomId).emit('FE-new-viewer', { viewerId: socket.id, userName });
  });
  
  socket.on('BE-viewer-send-signal', ({ userId, signal }) => {
    io.to(userId).emit('FE-viewer-signal', { viewerId: socket.id, signal });
  });
  
  socket.on('BE-send-signal-to-viewer', ({ viewerId, signal }) => {
    io.to(viewerId).emit('FE-viewer-receive-signal', { userId: socket.id, signal });
  });

  socket.on("BE-leave-viewer", ({ roomId }) => {
    console.log(`Viewer left room: ${roomId}`);
    socket.leave(roomId);
    delete viewers[socket.id];
    io.to(roomId).emit('FE-viewer-leave', { viewerId: socket.id });
  });

  socket.on("BE-check-user", ({ roomId, userName }) => {
    let error = false;
    console.log("BE-check-user", roomId, userName);
    io.sockets.in(roomId).clients((err, clients) => {
      clients.forEach((client) => {
        if (socketList[client] == userName) {
          error = true;
        }
      });
      socket.emit("FE-error-user-exist", { error });
    });
  });
  socket.on("BE-send-observer-message", ({ roomId, msg, sender }) => {
    console.log("Received observer message:", { roomId, msg, sender });
    io.to(roomId).emit("FE-receive-observer-message", { msg, sender });
  });
  socket.on("BE-join-room", ({ roomId, userName }) => {
    console.log("BE-join-room", roomId, userName);
    socket.join(roomId);
    socketList[socket.id] = { userName, video: true, audio: true, roomId };

    io.sockets.in(roomId).clients((err, clients) => {
      try {
        const users = clients.map((client) => ({
          userId: client,
          info: socketList[client],
        }));
        socket.broadcast.to(roomId).emit("FE-user-join", users);
        updateViewers(roomId);
      } catch (e) {
        io.sockets.in(roomId).emit("FE-error-user-exist", { err: true });
      }
    });
  });

  socket.on("BE-call-user", ({ userToCall, from, signal }) => {
    io.to(userToCall).emit("FE-receive-call", {
      signal,
      from,
      info: socketList[socket.id],
    });
  });

  socket.on("BE-accept-call", ({ signal, to }) => {
    io.to(to).emit("FE-call-accepted", {
      signal,
      answerId: socket.id,
    });
  });

  socket.on("BE-send-message", ({ roomId, msg, sender, isBreakoutRoom }) => {
    console.log("Received message:", { roomId, msg, sender, isBreakoutRoom });
    io.to(roomId).emit("FE-receive-message", {
      msg,
      sender,
      isBreakoutRoom,
      roomId,
    });
  });

  socket.on("BE-leave-room", ({ roomId, leaver }) => {
    console.log("User left room:", roomId, leaver);
    delete socketList[socket.id];
    socket.broadcast
      .to(roomId)
      .emit("FE-user-leave", { userId: socket.id, userName: leaver });
    socket.leave(roomId);
    updateViewers(roomId);
  });

  socket.on("BE-toggle-camera-audio", ({ roomId, switchTarget }) => {
    if (switchTarget === "video") {
      socketList[socket.id].video = !socketList[socket.id].video;
    } else {
      socketList[socket.id].audio = !socketList[socket.id].audio;
    }
    socket.broadcast
      .to(roomId)
      .emit("FE-toggle-camera", { userId: socket.id, switchTarget });
  });

  socket.on("BE-create-breakout-room", ({ mainRoomId, breakoutRoomName }) => {
    console.log("Received BE-create-breakout-room", {
      mainRoomId,
      breakoutRoomName,
    });
    if (!breakoutRooms[mainRoomId]) {
      breakoutRooms[mainRoomId] = [];
    }
    breakoutRooms[mainRoomId].push(breakoutRoomName);
    io.to(mainRoomId).emit(
      "FE-breakout-rooms-update",
      breakoutRooms[mainRoomId]
    );
  });

  socket.on(
    "BE-join-breakout-room",
    ({ mainRoomId, breakoutRoomName, userName }) => {
      console.log("User joining breakout room:", {
        mainRoomId,
        breakoutRoomName,
        userName,
      });
      socket.leave(mainRoomId);
      socket.join(breakoutRoomName);
      socketList[socket.id] = {
        userName,
        video: true,
        audio: true,
        breakoutRoom: breakoutRoomName,
      };

      const users = [];
      const clients = io.sockets.adapter.rooms[breakoutRoomName] || {};
      for (const clientId in clients) {
        if (socketList[clientId]) {
          users.push({
            userId: clientId,
            info: socketList[clientId],
          });
        }
      }
      socket.to(breakoutRoomName).emit("FE-user-join", users);
      socket.emit("FE-join-breakout-room", breakoutRoomName);
    }
  );

  socket.on("BE-leave-breakout-room", ({ mainRoomId, userName }) => {
    const breakoutRoom = socketList[socket.id].breakoutRoom;
    if (breakoutRoom) {
      console.log("User leaving breakout room:", {
        mainRoomId,
        breakoutRoom,
        userName,
      });
      socket.leave(breakoutRoom);
      delete socketList[socket.id].breakoutRoom;
      socket
        .to(breakoutRoom)
        .emit("FE-user-leave", { userId: socket.id, userName });
    }
    socket.join(mainRoomId);
    socket.emit("FE-leave-breakout-room");
  });

  socket.on("disconnect", () => {
    console.log("User disconnected!");
    const roomId = socketList[socket.id]?.roomId || viewers[socket.id]?.roomId;
    if (roomId) {
      socket.broadcast.to(roomId).emit("FE-user-leave", {
        userId: socket.id,
        userName: socketList[socket.id]?.userName || viewers[socket.id]?.userName,
      });
      delete socketList[socket.id];
      delete viewers[socket.id];
      updateViewers(roomId);
    }
  });
});

function updateViewers(roomId) {
  const room = io.sockets.adapter.rooms[roomId];
  if (room) {
    const clients = Object.keys(room.sockets);
    const streams = clients.map((clientId) => ({
      id: clientId,
      userName: socketList[clientId]?.userName || "Anonymous",
      stream: null, // Actual stream data cannot be sent directly
    }));
    io.to(roomId).emit("FE-viewer-update-streams", streams);
  }
}

http.listen(PORT, () => {
  console.log("Server Connected on Port:", PORT);
});