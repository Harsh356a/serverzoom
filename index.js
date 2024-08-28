const express = require("express");
const app = express();
const http = require("http").createServer(app);
const io = require("socket.io")(http);
const PORT = process.env.PORT || 3001;
const path = require("path");

let socketList = {};
let breakoutRooms = {};

// app.use(express.static(path.join(__dirname, 'public'))); // this will work for CRA build
app.use(express.static(path.join(__dirname, "../vite")));

if (process.env.NODE_ENV === "production") {
  app.use(express.static(path.join(__dirname, "../client/build")));

  app.get("/*", function (req, res) {
    res.sendFile(path.join(__dirname, "../client/build/index.html"));
  });
}

// Route
app.get("/ping", (req, res) => {
  res
    .send({
      success: true,
    })
    .status(200);
});

// Socket
io.on("connection", (socket) => {
  console.log(`New User connected: ${socket.id}`);

  socket.on("disconnect", () => {
    socket.disconnect();
    console.log("User disconnected!");
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

  /**
   * Join Room
   */
  socket.on("BE-join-room", ({ roomId, userName }) => {
    // Socket Join RoomName
    console.log("BE-join-room", roomId, userName);
    socket.join(roomId);
    socketList[socket.id] = { userName, video: true, audio: true };

    // Set User List
    io.sockets.in(roomId).clients((err, clients) => {
      try {
        const users = [];
        clients.forEach((client) => {
          // Add User List
          users.push({ userId: client, info: socketList[client] });
        });
        socket.broadcast.to(roomId).emit("FE-user-join", users);
        // io.sockets.in(roomId).emit('FE-user-join', users);
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
    if (isBreakoutRoom) {
      // Send only to sockets in the specific breakout room
      io.to(roomId).emit("FE-receive-message", {
        msg,
        sender,
        isBreakoutRoom,
        roomId,
      });
    } else {
      // Send to all sockets in the main room
      io.to(roomId).emit("FE-receive-message", {
        msg,
        sender,
        isBreakoutRoom,
        roomId,
      });
    }
  });

  socket.on("BE-leave-room", ({ roomId, leaver }) => {
    delete socketList[socket.id];
    socket.broadcast
      .to(roomId)
      .emit("FE-user-leave", { userId: socket.id, userName: [socket.id] });
    io.sockets.sockets[socket.id].leave(roomId);
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
    });

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
      answerId: socket.id  // Use socket.id instead of undefined answerId
    });
  })
});

http.listen(PORT, () => {
  console.log("Connected : ", PORT);
});
