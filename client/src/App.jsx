import React, { useState } from 'react';
import Login from './components/Login';
import ChatRoom from './components/ChatRoom';

function App() {
  const [username, setUsername] = useState(null);

  return (
    <div>
      {!username ? (
        <Login onLogin={setUsername} />
      ) : (
        <ChatRoom username={username} onLogout={() => setUsername(null)} />
      )}
    </div>
  );
}

export default App;
