// tslint:disable: no-unused-expression

import { Namespace, Socket } from "socket.io";
import L from "../common/logger";

export default (io: Namespace) => {
  io.on("connection", async (socket: Socket) => {
    const { session } = socket.handshake.query;

    // if session arg not provided, return error and refuse connection
    if (!session || session === "undefined" || session === "") {
      io.to(socket.id).emit("CONNECTION_FAILURE", {
        msg: "Missing session argument",
      });
      socket.disconnect();
    } else {
      await socket.join(session);
      L.info('socked ' + socket.id + ' joined to session ' + session) + ' room size='+io.adapter.rooms.get(session as string).size;
      socket.on('PGPS_READY', (data, callback)=>{
        const validCallback = callback && typeof callback === "function";
        socket.to(`${session}`).emit("PGPS_READY", data);
        validCallback && callback({ ok: true });
      })
      socket.on('PGPS_READY_RECEIVED', (data, callback)=>{
        const validCallback = callback && typeof callback === "function";
        socket.to(`${session}`).emit("PGPS_READY_RECEIVED", data);
        validCallback && callback({ ok: true });
      })
      socket.on('RUN_NFT_MINT', (data, callback)=>{
        const validCallback = callback && typeof callback === "function";
        socket.to(`${session}`).emit("RUN_NFT_MINT", data);
        validCallback && callback({ ok: true });
      })
      socket.on('RUN_NFT_MINT_RECEIVED', (data, callback)=>{
        const validCallback = callback && typeof callback === "function";
        socket.to(`${session}`).emit("RUN_NFT_MINT_RECEIVED", data);
        validCallback && callback({ ok: true });
      })
      socket.on("MINTING_NFT", (data, callback) => {
        const validCallback = callback && typeof callback === "function";
        socket.to(`${session}`).emit("MINTING_NFT", data);
        // confirm success to mobile app
        validCallback && callback({ ok: true });
      });
      socket.on("MINTING_NFT_RECEIVED", (data, callback) => {
        const validCallback = callback && typeof callback === "function";
        socket.to(`${session}`).emit("MINTING_NFT_RECEIVED", data);
        // confirm success to mobile app
        validCallback && callback({ ok: true });
      });
      socket.on('disconnect', () => {
        console.log('user disconnected');
        socket.to(`${session}`).emit("USER_DISCONNECT", 1);
      })
      socket.on('timeout', () => {
        console.log('user timeout');
        socket.to(`${session}`).emit("USER_TIMEOUT", 1);
      })
      socket.on('close', () => {
        console.log('user close');
        socket.to(`${session}`).emit("USER_CLOSE", 1);
      })
      io.to(socket.id).emit("CONNECTION_SUCCESS", {
        msg: "Connection successful",
      });
    }
  });
};
