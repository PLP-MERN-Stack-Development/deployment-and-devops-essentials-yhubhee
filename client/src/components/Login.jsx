import React, { useState } from 'react';
import { useSocket } from '../socket/socket';

const Login = ({ onLogin }) => {
  const [username, setUsername] = useState('');
  const { connect } = useSocket();

  const handleLogin = (e) => {
    e.preventDefault();
    if (username.trim()) {
      connect(username);
      onLogin(username);
    }
  };

  return (
    <div className="login-page">
      <h2>Join the Chat</h2>
      <form onSubmit={handleLogin}>
        <input
          type="text"
          placeholder="Enter a username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <button type="submit">Join</button>
      </form>
    </div>
  );
};

export default Login;
