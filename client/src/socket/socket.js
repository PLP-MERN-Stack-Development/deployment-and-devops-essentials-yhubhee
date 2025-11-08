// client/src/socket.js
import { io } from 'socket.io-client';
import { useEffect, useState } from 'react';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:5000';

export const socket = io(SOCKET_URL, {
  autoConnect: false,
  reconnection: true,
  reconnectionAttempts: 5,
  reconnectionDelay: 1000,
});

// Hook
export const useSocket = () => {
  const [isConnected, setIsConnected] = useState(socket.connected);
  const [lastMessage, setLastMessage] = useState(null);
  const [messages, setMessages] = useState([]); // room messages or global
  const [privateMessagesMap, setPrivateMessagesMap] = useState({}); // userId -> [msgs]
  const [users, setUsers] = useState([]);
  const [typingUsers, setTypingUsers] = useState([]);
  const [rooms, setRooms] = useState(['global']);
  const [currentRoom, setCurrentRoom] = useState('global');

  // Connect with username
  const connect = (username) => {
    socket.connect();
    socket.emit('join', { username }, (resp) => {
      // resp contains userId
    });
  };

  const disconnect = () => {
    socket.disconnect();
  };

  // Messaging APIs
  const sendRoomMessage = (room, text, data = null) => {
    return new Promise((resolve) => {
      socket.emit('room:message', { room, text, data }, (ack) => {
        resolve(ack);
      });
    });
  };

  const sendPrivateMessage = (toSocketId, text, data = null) => {
    return new Promise((resolve) => {
      socket.emit('private_message', { to: toSocketId, text, data }, (ack) => {
        resolve(ack);
      });
    });
  };

  const joinRoom = (room) => {
    return new Promise((resolve) => {
      socket.emit('room:join', { room }, (ack) => {
        if (ack && ack.messages) setMessages(ack.messages);
        setCurrentRoom(room);
        resolve(ack);
      });
    });
  };

  const leaveRoom = (room) => {
    return new Promise((resolve) => {
      socket.emit('room:leave', { room }, (ack) => {
        resolve(ack);
      });
    });
  };

  const setTyping = (room, typing) => {
    socket.emit('typing', { room, typing });
  };

  const requestRooms = () => {
    socket.emit('get:rooms', (payload) => {
      if (payload && payload.rooms) setRooms(payload.rooms);
    });
  };

  const getPrivateHistory = (withUserId) => {
    return new Promise((resolve) => {
      socket.emit('get:privateHistory', { withUserId }, (resp) => {
        if (resp && resp.messages) {
          setPrivateMessagesMap((prev) => ({ ...prev, [withUserId]: resp.messages }));
        }
        resolve(resp);
      });
    });
  };

  const markMessageRead = (opts) => {
    // opts: { room?, messageId, privateWith? }
    return new Promise((resolve) => {
      socket.emit('message:read', opts, (ack) => {
        resolve(ack);
      });
    });
  };

  const reactMessage = (opts) => {
    // opts: { room?, messageId, reaction, privateWith? }
    return new Promise((resolve) => {
      socket.emit('message:react', opts, (ack) => {
        resolve(ack);
      });
    });
  };

  // Listeners
  useEffect(() => {
    const onConnect = () => setIsConnected(true);
    const onDisconnect = () => setIsConnected(false);

    const onInit = (payload) => {
      if (payload?.rooms) setRooms(payload.rooms);
      if (payload?.messages) setMessages(payload.messages);
    };

    const onUserList = (list) => setUsers(list);
    const onUserJoined = (u) => {
      setMessages((prev) => [
        ...prev,
        { id: `sys-${Date.now()}`, system: true, message: `${u.username} joined`, ts: new Date().toISOString() },
      ]);
    };
    const onUserLeft = (u) => {
      setMessages((prev) => [
        ...prev,
        { id: `sys-${Date.now()}`, system: true, message: `${u.username} left`, ts: new Date().toISOString() },
      ]);
    };

    const onRoomMessage = (msg) => {
      setLastMessage(msg);
      setMessages((prev) => [...prev, msg]);
    };

    const onPrivateMessage = (msg) => {
      setLastMessage(msg);
      setPrivateMessagesMap((prev) => {
        const other = msg.from.userId === socket.id ? msg.to : msg.from.userId;
        const arr = prev[other] || [];
        return { ...prev, [other]: [...arr, msg] };
      });
    };

    const onTyping = (list) => setTypingUsers(list || []);
    const onMessageRead = (payload) => {
      const { messageId, by } = payload;
      setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, readBy: (m.readBy || []).concat([by]) } : m)));
    };
    const onMessageReact = ({ messageId, reactions }) => {
      setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, reactions } : m)));
    };

    const onRoomList = (list) => setRooms(list);

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);

    socket.on('init', onInit);
    socket.on('user_list', onUserList);
    socket.on('user_joined', onUserJoined);
    socket.on('user_left', onUserLeft);

    socket.on('room:message', onRoomMessage);
    socket.on('private_message', onPrivateMessage);

    socket.on('typing_users', onTyping);
    socket.on('message:read', onMessageRead);
    socket.on('message:react', onMessageReact);

    socket.on('room_list', onRoomList);

    // Cleanup
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('init', onInit);
      socket.off('user_list', onUserList);
      socket.off('user_joined', onUserJoined);
      socket.off('user_left', onUserLeft);
      socket.off('room:message', onRoomMessage);
      socket.off('private_message', onPrivateMessage);
      socket.off('typing_users', onTyping);
      socket.off('message:read', onMessageRead);
      socket.off('message:react', onMessageReact);
      socket.off('room_list', onRoomList);
    };
  }, []);

  return {
    socket,
    isConnected,
    lastMessage,
    messages,
    privateMessagesMap,
    users,
    typingUsers,
    rooms,
    currentRoom,
    connect,
    disconnect,
    sendRoomMessage,
    sendPrivateMessage,
    joinRoom,
    leaveRoom,
    setTyping,
    requestRooms,
    getPrivateHistory,
    markMessageRead,
    reactMessage,
  };
};

export default socket;
