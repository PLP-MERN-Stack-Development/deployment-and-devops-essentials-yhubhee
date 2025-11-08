import React, { useEffect, useRef, useState } from "react";
import { useSocket } from "../socket/socket"; // adjust path if needed
import { fileToBase64 } from "../utils/fileUtils";

const REACTIONS = ["👍", "❤️", "😂", "😮", "😢"];

export default function ChatRoom({ username, onLogout }) {
  const {
    socket,
    isConnected,
    messages,
    users,
    typingUsers,
    currentRoom,
    sendRoomMessage,
    sendPrivateMessage,
    joinRoom,
    setTyping,
    markMessageRead,
    reactMessage,
  } = useSocket();

  const [input, setInput] = useState("");
  const [selectedUser, setSelectedUser] = useState(null); // private chat target
  const fileRef = useRef();
  const bottomRef = useRef();

  // scroll to bottom on new message
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // handle sending message (room or private)
  const handleSend = async (e) => {
    e.preventDefault();
    if (!input.trim()) return;

    if (selectedUser) {
      await sendPrivateMessage(selectedUser.id || selectedUser.userId, input);
    } else {
      await sendRoomMessage(currentRoom || "global", input);
    }

    setInput("");
    setTyping(currentRoom || "global", false);
  };

  // handle file upload (convert to base64)
  const handleFileChosen = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const maxBytes = 5 * 1024 * 1024;
    if (file.size > maxBytes) {
      alert("File too large. Please choose a file smaller than 5 MB.");
      e.target.value = "";
      return;
    }

    try {
      const base64 = await fileToBase64(file);
      const fileData = { name: file.name, base64 };

      if (selectedUser) {
        await sendPrivateMessage(selectedUser.id || selectedUser.userId, null, fileData);
      } else {
        await sendRoomMessage(currentRoom || "global", null, fileData);
      }
      e.target.value = "";
    } catch (err) {
      console.error("File upload error:", err);
      alert("Failed to upload file");
    }
  };

  // mark message as read
  const handleMarkRead = async (msg) => {
    if (!msg) return;

    if (msg.isPrivate || msg.to) {
      const other = msg.from?.userId === socket.id ? msg.to : msg.from?.userId;
      await markMessageRead({ privateWith: other, messageId: msg.id });
    } else {
      await markMessageRead({ room: msg.room || currentRoom || "global", messageId: msg.id });
    }
  };

  // react to message
  const handleReact = async (msg, reaction) => {
    if (!msg) return;
    if (msg.isPrivate || msg.to) {
      const other = msg.from?.userId === socket.id ? msg.to : msg.from?.userId;
      await reactMessage({ privateWith: other, messageId: msg.id, reaction });
    } else {
      await reactMessage({ room: msg.room || currentRoom || "global", messageId: msg.id, reaction });
    }
  };

  return (
    <div className="chat-room" style={{ display: "flex", height: "100vh" }}>
      {/* LEFT SIDEBAR: Users */}
      <aside style={{ width: 220, borderRight: "1px solid #ddd", padding: 12 }}>
        <h3>Hi, {username}</h3>
        <p>Status: {isConnected ? "🟢 Online" : "🔴 Offline"}</p>
        <button onClick={onLogout}>Logout</button>
        <hr />

        <h4>People</h4>
        <ul style={{ listStyle: "none", paddingLeft: 0 }}>
          {users.map((u) => (
            <li key={u.id || u.userId} style={{ marginBottom: 6 }}>
              <button
                onClick={() => setSelectedUser(u)}
                style={{
                  background:
                    selectedUser?.id === (u.id || u.userId) ? "#eef" : "transparent",
                  border: "none",
                  padding: 6,
                  cursor: "pointer",
                  width: "100%",
                  textAlign: "left",
                }}
              >
                {u.username}{" "}
                {u.id === socket.id || u.userId === socket.id ? "(You)" : ""}
                <span style={{ float: "right" }}>
                  {u.online === false ? "⚪" : "🟢"}
                </span>
              </button>
            </li>
          ))}
        </ul>

        <hr />
        <h4>Typing</h4>
        <div>
          {typingUsers?.length
            ? typingUsers.join(", ") + " is typing..."
            : "None"}
        </div>
      </aside>

      {/* MIDDLE: Messages */}
      <main style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        <div style={{ padding: 12, borderBottom: "1px solid #eee" }}>
          <strong>
            {selectedUser
              ? `Private: ${selectedUser.username}`
              : `Room: ${currentRoom || "global"}`}
          </strong>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: 12 }}>
          {messages.map((m) => (
            <div
              key={m.id}
              onClick={() => handleMarkRead(m)}
              style={{
                padding: 8,
                marginBottom: 8,
                background:
                  m.from?.userId === socket.id ? "#e6ffe6" : "#fff",
                border: "1px solid #ddd",
                borderRadius: 6,
                maxWidth: "80%",
              }}
            >
              <div style={{ fontSize: 12, color: "#555" }}>
                <strong>{m.from?.username || "System"}</strong>{" "}
                <span style={{ marginLeft: 8 }}>
                  {new Date(m.ts).toLocaleString()}
                </span>
                {m.readBy?.length > 0 && (
                  <span style={{ float: "right", fontSize: 11, color: "#888" }}>
                    Read by {m.readBy.length}
                  </span>
                )}
              </div>

              {/* TEXT */}
              {m.type === "text" && (
                <div style={{ marginTop: 6 }}>{m.text || m.message}</div>
              )}

              {/* FILE / IMAGE */}
              {m.type === "file" && m.data && (
                <div style={{ marginTop: 8 }}>
                  <div style={{ fontSize: 13 }}>{m.data.name}</div>
                  {typeof m.data.base64 === "string" &&
                  m.data.base64.startsWith("data:image") ? (
                    <img
                      src={m.data.base64}
                      alt={m.data.name}
                      style={{
                        maxWidth: "300px",
                        marginTop: 6,
                        borderRadius: 4,
                      }}
                    />
                  ) : (
                    <a href={m.data.base64} download={m.data.name}>
                      Download {m.data.name}
                    </a>
                  )}
                </div>
              )}

              {/* REACTIONS */}
              <div
                style={{
                  marginTop: 8,
                  display: "flex",
                  gap: 8,
                  alignItems: "center",
                }}
              >
                {REACTIONS.map((r) => (
                  <button
                    key={r}
                    onClick={() => handleReact(m, r)}
                    style={{ cursor: "pointer" }}
                  >
                    {r}
                    <span style={{ marginLeft: 6 }}>
                      {(m.reactions && m.reactions[r]) || ""}
                    </span>
                  </button>
                ))}
                <div
                  style={{ marginLeft: "auto", fontSize: 12, color: "#888" }}
                >
                  {m.isPrivate ? "Private" : ""}
                </div>
              </div>
            </div>
          ))}

          <div ref={bottomRef} />
        </div>

        {/* INPUT */}
        <form
          onSubmit={handleSend}
          style={{
            padding: 12,
            borderTop: "1px solid #eee",
            display: "flex",
            gap: 8,
          }}
        >
          <input
            type="text"
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setTyping(currentRoom || "global", e.target.value.length > 0);
            }}
            placeholder={
              selectedUser
                ? `Message ${selectedUser.username}`
                : "Message..."
            }
            style={{ flex: 1, padding: 8 }}
          />
          <input
            ref={fileRef}
            type="file"
            onChange={handleFileChosen}
            style={{ display: "inline-block" }}
          />
          <button type="submit" style={{ padding: "8px 12px" }}>
            Send
          </button>
        </form>
      </main>

      {/* RIGHT SIDEBAR: Room controls */}
      <aside style={{ width: 220, borderLeft: "1px solid #ddd", padding: 12 }}>
        <h4>Actions</h4>
        <button onClick={() => { setSelectedUser(null); joinRoom("global"); }}>
          Join Global
        </button>
        <div style={{ marginTop: 12 }}>
          <strong>Selected:</strong>
          <div>{selectedUser ? selectedUser.username : "Room"}</div>
        </div>
      </aside>
    </div>
  );
}
