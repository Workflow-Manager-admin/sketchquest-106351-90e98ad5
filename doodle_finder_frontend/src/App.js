import React, { useState, useEffect, useRef } from 'react';
import './App.css';
import { app, db } from './services/firebase';
import { uploadToImgbb } from './services/imgbb';
import {
  collection,
  doc,
  setDoc,
  getDoc,
  updateDoc,
  addDoc,
  getDocs,
  onSnapshot,
  query,
  where,
  orderBy,
} from 'firebase/firestore';

// Game prompt pool: animals/birds
const PROMPT_POOL = [
  "Elephant","Cat","Dog","Parrot","Owl","Shark",
  "Fox","Eagle","Penguin","Frog","Dolphin","Horse",
  "Rabbit", "Lion", "Swan", "Koala", "Bear", "Peacock",
  "Whale", "Wolf", "Chicken", "Duck", "Panda", "Hawk"
];
const DRAW_TIME = 30; // seconds

// PUBLIC_INTERFACE
function App() {
  // App-level state
  const [theme, setTheme] = useState('light');
  const [user, setUser] = useState('');
  const [loginModal, setLoginModal] = useState(true);
  const [competitionId, setCompetitionId] = useState('');
  const [inCompetition, setInCompetition] = useState(false);
  const [currentStage, setCurrentStage] = useState('lobby'); // 'draw', 'guess', 'vote', 'results'
  const [players, setPlayers] = useState([]);
  const [playerId, setPlayerId] = useState('');
  const [prompt, setPrompt] = useState(''); // what to draw (selected per player)
  const [round, setRound] = useState(1);
  const [drawings, setDrawings] = useState([]); // {id, playerName, url}
  const [guesses, setGuesses] = useState([]); // {drawingId, playerName, guess}
  const [votes, setVotes] = useState([]); // {voteFor, voterId}
  const [winner, setWinner] = useState(null);
  const [winningDrawing, setWinningDrawing] = useState(null);
  const [correctAnswer, setCorrectAnswer] = useState('');
  const [sidebarExpanded, setSidebarExpanded] = useState(true);

  // Drawing state
  const [canvasModal, setCanvasModal] = useState(false);
  const [timer, setTimer] = useState(DRAW_TIME);
  const [drawingDataUrl, setDrawingDataUrl] = useState('');
  const [drawingUploading, setDrawingUploading] = useState(false);

  // Guessing/chat state
  const [guessInput, setGuessInput] = useState('');
  const [chatMessages, setChatMessages] = useState([]); // Guess list

  // Voting state
  const [voteForId, setVoteForId] = useState('');
  const [voteSubmitted, setVoteSubmitted] = useState(false);

  // Modals
  const [resultModal, setResultModal] = useState(false);

  // refs
  const canvasRef = useRef(null);
  const drawingContextRef = useRef(null);
  const [isDrawing, setIsDrawing] = useState(false);

  // UI: theme
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);
  // UI: scroll chat
  useEffect(() => {
    const el = document.querySelector('.guess-chat-log');
    if (el) el.scrollTop = el.scrollHeight;
  }, [chatMessages]);

  // ---- Authentication: Username only ----
  // PUBLIC_INTERFACE
  function handleLogin(username) {
    if (!username || username.length < 2) return;
    setUser(username);
    setLoginModal(false);
    setPlayerId(username + '_' + Math.random().toString(36).slice(-6));
  }

  // ---- Competition join/create ----
  // PUBLIC_INTERFACE
  async function handleJoinCompetition(joinId) {
    if (!joinId || !user) return;
    // ensure competition exists or create
    const gameDocRef = doc(db, 'competitions', joinId);
    const snapshot = await getDoc(gameDocRef);
    if (!snapshot.exists()) {
      // create0
      await setDoc(gameDocRef, {
        createdAt: new Date().toISOString(),
        round: 1,
        stage: 'lobby',
        players: [{
          id: playerId,
          name: user
        }],
      });
    } else {
      // update player list
      const data = snapshot.data();
      const present = (data.players || []).find(p => p.id === playerId);
      if (!present) {
        await updateDoc(gameDocRef, {
          players: [...(data.players || []), { id: playerId, name: user }]
        });
      }
    }
    setCompetitionId(joinId);
    setInCompetition(true);
  }

  // Listen to game state from Firestore
  useEffect(() => {
    if (!competitionId) return;
    const unsub = onSnapshot(doc(db, 'competitions', competitionId), (snap) => {
      const data = snap.data();
      setPlayers(data.players || []);
      setCurrentStage(data.stage || 'lobby');
      setRound(data.round || 1);
      if (data.promptByPlayer) setPrompt(data.promptByPlayer[playerId]);
      if (data.drawings) setDrawings(data.drawings);
      if (data.guesses) setGuesses(data.guesses);
      if (data.votes) setVotes(data.votes);
      if (data.winner !== undefined) setWinner(data.winner);
      if (data.winningDrawing !== undefined) setWinningDrawing(data.winningDrawing);
      if (data.correctAnswer !== undefined) setCorrectAnswer(data.correctAnswer);
    });
    return () => unsub();
    // eslint-disable-next-line
  }, [competitionId, playerId]);

  // ---- Stage transitions ----
  // Host triggers stage via control buttons
  async function startRound() {
    // Each player gets a prompt
    const shuffledPrompts = PROMPT_POOL.sort(() => 0.5 - Math.random());
    const promptByPlayer = {};
    players.forEach((p, idx) => {
      promptByPlayer[p.id] = shuffledPrompts[idx % shuffledPrompts.length];
    });
    await updateDoc(doc(db, 'competitions', competitionId), {
      promptByPlayer,
      stage: 'draw',
      drawings: [],
      guesses: [],
      votes: [],
      winner: null,
      winningDrawing: null,
      correctAnswer: '',
    });
    setTimer(DRAW_TIME);
    setCanvasModal(true);
    setPrompt(promptByPlayer[playerId]);
  }

  // For host: end drawing phase
  async function endDrawing() {
    // move to guessing
    await updateDoc(doc(db, 'competitions', competitionId), {
      stage: 'guess'
    });
  }
  async function endGuessing() {
    await updateDoc(doc(db, 'competitions', competitionId), {
      stage: 'vote'
    });
  }
  async function endVoting() {
    const compSnap = await getDoc(doc(db, 'competitions', competitionId));
    const data = compSnap.data();
    // Tally votes
    const tally = {};
    (data.votes || []).forEach(v => {
      if (!tally[v.voteFor]) tally[v.voteFor] = 0;
      tally[v.voteFor]++;
    });
    const winnerId = Object.entries(tally).sort((a,b) => b[1]-a[1])[0]?.[0];
    const winning = (data.drawings || []).find(d => d.playerId === winnerId);
    const correctPrompt = data.promptByPlayer[winnerId] || '';
    await updateDoc(doc(db, 'competitions', competitionId), {
      stage: 'results',
      winner: winnerId,
      winningDrawing: winning,
      correctAnswer: correctPrompt
    });
    setResultModal(true);
  }
  function resetGame() {
    setResultModal(false);
    setDrawingDataUrl('');
    setDrawingUploading(false);
    setVoteForId('');
    setVoteSubmitted(false);
  }

  // ---- Drawing canvas logic ----
  useEffect(() => {
    if (!canvasModal) return;
    setTimer(DRAW_TIME);
    let interval;
    if (currentStage === 'draw') {
      interval = setInterval(() => {
        setTimer(t => {
          if (t <= 1) {
            clearInterval(interval);
            handleSubmitDrawing();
            return 0;
          }
          return t - 1;
        });
      }, 1000);
    }
    return () => clearInterval(interval);
    // eslint-disable-next-line
  }, [canvasModal, currentStage]);

  function startDrawing(e) {
    e.preventDefault();
    setIsDrawing(true);
    const rect = canvasRef.current.getBoundingClientRect();
    const x = (e.touches ? e.touches[0].clientX : e.nativeEvent.offsetX) - rect.left;
    const y = (e.touches ? e.touches[0].clientY : e.nativeEvent.offsetY) - rect.top;
    drawingContextRef.current.beginPath();
    drawingContextRef.current.moveTo(x, y);
  }
  function draw(e) {
    if (!isDrawing) return;
    e.preventDefault();
    const rect = canvasRef.current.getBoundingClientRect();
    const x = (e.touches ? e.touches[0].clientX : e.nativeEvent.offsetX) - rect.left;
    const y = (e.touches ? e.touches[0].clientY : e.nativeEvent.offsetY) - rect.top;
    drawingContextRef.current.lineTo(x, y);
    drawingContextRef.current.stroke();
  }
  function endDrawing(e) {
    if (!isDrawing) return;
    setIsDrawing(false);
    drawingContextRef.current.closePath();
  }
  function clearCanvas() {
    const ctx = drawingContextRef.current;
    ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
  }
  useEffect(() => {
    if (canvasModal) {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      ctx.lineCap = 'round';
      ctx.lineWidth = 5;
      ctx.strokeStyle = theme === 'light' ? '#66c4ff' : '#fafafa';
      ctx.fillStyle = '#ffffff';
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      drawingContextRef.current = ctx;
    }
    // eslint-disable-next-line
  }, [canvasModal, theme]);

  // ---- Drawing submission ----
  // PUBLIC_INTERFACE
  async function handleSubmitDrawing() {
    if (drawingUploading) return;
    setDrawingUploading(true);
    // Export canvas to base64 (dataURL)
    const url = canvasRef.current.toDataURL("image/png");
    setDrawingDataUrl(url);
    // Upload to imgbb
    let imgUrl = '';
    try {
      imgUrl = await uploadToImgbb(url);
    } catch(err) { alert('Failed to upload image'); }
    // Store drawing
    const drawingObj = {
      playerId,
      playerName: user,
      url: imgUrl,
    };
    const compSnap = await getDoc(doc(db,"competitions",competitionId));
    const data = compSnap.data();
    const drawingsArr = data.drawings || [];
    await updateDoc(doc(db, "competitions", competitionId), {
      drawings: [...drawingsArr, drawingObj]
    });
    setDrawingUploading(false);
    setCanvasModal(false);
  }

  // ---- Guessing/chat logic ----
  // PUBLIC_INTERFACE
  function handleGuessInput(e) {
    setGuessInput(e.target.value);
  }
  // PUBLIC_INTERFACE
  async function submitGuess() {
    if (!guessInput.trim()) return;
    const guessObj = {
      drawingId: guessTargetId(),
      playerName: user,
      guess: guessInput.trim(),
    };
    const compSnap = await getDoc(doc(db,"competitions",competitionId));
    const data = compSnap.data();
    const guessesArr = data.guesses || [];
    await updateDoc(doc(db, "competitions", competitionId), {
      guesses: [...guessesArr, guessObj]
    });
    setGuessInput('');
  }
  // Determine whose drawing we're guessing on (not self)
  function guessTargetId() {
    // Typically, take next player id after you
    if (!drawings.length) return '';
    const idx = drawings.findIndex(d => d.playerId === playerId);
    // Wrap around to next drawing (excluding self)
    let nextIdx = (idx + 1) % drawings.length;
    return drawings.filter(d => d.playerId !== playerId)[0]?.playerId || drawings[0].playerId;
  }

  // ---- Voting logic ----
  // PUBLIC_INTERFACE
  async function submitVote(voteFor) {
    if (!voteFor || voteFor === playerId) return;
    const voteObj = {
      voterId: playerId,
      voteFor,
    };
    const compSnap = await getDoc(doc(db,"competitions",competitionId));
    const data = compSnap.data();
    const votesArr = data.votes || [];
    // No double voting
    if (votesArr.find(v => v.voterId === playerId)) return;
    await updateDoc(doc(db, "competitions", competitionId), {
      votes: [...votesArr, voteObj]
    });
    setVoteForId(voteFor);
    setVoteSubmitted(true);
  }

  // ---- UI/Render ----
  function PlayerList() {
    return (
      <div className={`sidebar ${sidebarExpanded ? '' : 'collapsed'}`}>
        <button onClick={()=>setSidebarExpanded(e=>!e)} className="sidebar-toggle">
          {sidebarExpanded ? '<' : '>'}
        </button>
        <h3 className="sidebar-title">Players</h3>
        <ul className="sidebar-list">
          {players.map(p => (
            <li key={p.id} className={p.id === playerId ? 'me' : ''}>{p.name} {p.id === playerId && "(you)"}</li>
          ))}
        </ul>
      </div>
    );
  }
  function LobbyControls() {
    const isHost = players.length && players[0].id === playerId;
    return (
      <div className="lobby-controls">
        <h2>Welcome {user}!</h2>
        <p>Share the code to invite others:<br /><b>{competitionId}</b></p>
        {isHost && (
          <button className="btn-primary" onClick={startRound}>
            Start Drawing Round
          </button>
        )}
        <small>{players.length} joined</small>
      </div>
    );
  }
  function DrawingModal() {
    return (
      <div className="modal-backdrop">
        <div className="modal">
          <h2>Draw: <span className="highlight">{prompt}</span></h2>
          <p>You have <b>{timer}</b> seconds. Use your mouse or touch.</p>
          <canvas
            ref={canvasRef}
            width={340}
            height={340}
            className="drawing-canvas"
            style={{
              border: "2px solid #66c4ff",
              background: "#fafafa",
              borderRadius: 18,
              cursor: "crosshair"
            }}
            onMouseDown={startDrawing}
            onTouchStart={startDrawing}
            onMouseMove={draw}
            onTouchMove={draw}
            onMouseUp={endDrawing}
            onMouseLeave={endDrawing}
            onTouchEnd={endDrawing}
          />
          <div className="canvas-controls">
            <button onClick={clearCanvas} className="btn">Clear</button>
            <button onClick={handleSubmitDrawing} className="btn-accent" disabled={drawingUploading}>
              {drawingUploading ? "Uploading..." : "Submit"}
            </button>
          </div>
        </div>
      </div>
    );
  }
  function GuessingSection() {
    // Show drawing and chat/guess box
    const drawingToGuess = drawings.find(d => d.playerId === guessTargetId());
    return (
      <div className="guess-section">
        <h2>Guess What This Is!</h2>
        <img src={drawingToGuess?.url} alt="drawing to guess" className="guess-drawing" />
        <div className="guess-chat-log">
          {(guesses.filter(g => g.drawingId === guessTargetId()) || [])
          .map((g,i) => (
            <div key={i} className={g.playerName === user ? 'me-msg' : ''}>
              <b>{g.playerName}:</b> {g.guess}
            </div>
          ))}
        </div>
        <div className="guess-input-controls">
          <input type="text" placeholder="Your guess..." value={guessInput} onChange={handleGuessInput} />
          <button onClick={submitGuess} className="btn">Send Guess</button>
        </div>
      </div>
    );
  }
  function VotingSection() {
    return (
      <div className="vote-section">
        <h2>Vote for the Best Drawing!</h2>
        <div className="drawing-grid">
          {drawings.filter(d => d.playerId !== playerId).map(d => (
            <div key={d.playerId} className={`vote-card ${voteForId === d.playerId ? 'selected' : ''}`}>
              <img src={d.url} alt="drawing" className="drawing-thumb"/>
              <p>by {d.playerName}</p>
              <button
                onClick={() => submitVote(d.playerId)}
                className="btn-accent"
                disabled={voteForId && voteForId !== d.playerId}
              >
                {voteForId === d.playerId ? "Voted" : "Vote"}
              </button>
            </div>
          ))}
        </div>
      </div>
    );
  }
  function ResultModal() {
    return (
      <div className="modal-backdrop">
        <div className="modal result-modal">
          <h2>Winner 🎉</h2>
          <div className="winner-section">
            <img src={winningDrawing?.url} alt="Winner drawing" className="drawing-winner" />
            <p><b>{players.find(p=>p.id===winner)?.name || "?"}</b> won!</p>
            <div>
              <b>Correct Answer:</b> <span className="highlight">{correctAnswer}</span>
            </div>
            <button className="btn-primary" onClick={resetGame}>
              OK!
            </button>
          </div>
        </div>
      </div>
    );
  }
  // PUBLIC_INTERFACE
  function handleCompetitionEntry(inputValue) {
    // Accept 6-15 char codes, or create random
    let val = inputValue.trim();
    if (val.length < 6) {
      val = Math.random().toString(36).substring(2,8).toUpperCase();
    }
    handleJoinCompetition(val);
  }
  // PUBLIC_INTERFACE
  function handleUsernameSubmit(evt) {
    evt.preventDefault();
    if (user.trim().length > 1) handleLogin(user.trim());
  }
  // PUBLIC_INTERFACE
  function handleUserChange(evt) {
    setUser(evt.target.value);
  }

  // UI Main Layout
  return (
    <div className="App">
      <header className="main-header" style={{
        background: "#66c4ff", color: "#030303", display: "flex", alignItems: "center",
        justifyContent: "space-between", padding: "0.4rem 1.5rem"
      }}>
        <div>
          <span role="img" aria-label="doodle" style={{fontSize:"2rem",marginRight:8}}>🎨</span>
          <b>Doodle Finder</b>
        </div>
        {user ? (
          <span className="user-info">👤 {user}</span>
        ) : null}
        <button
          className="theme-toggle"
          onClick={() => setTheme(t=>t==='light'? 'dark':'light')}
          aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
        >
          {theme === 'light' ? '🌙 Dark' : '☀️ Light'}
        </button>
      </header>
      <main className="doodle-main-layout">
        <PlayerList />
        <section className="core-game">
          {!inCompetition &&
            <div className="join-modal modal-backdrop">
              <div className="modal">
                <h1>Join or Create a Game</h1>
                <form onSubmit={e => {
                  e.preventDefault();
                  handleCompetitionEntry(document.getElementById("gamecode").value);
                }}>
                  <label htmlFor="gamecode">Game Code:</label>
                  <input id="gamecode" type="text" minLength={6} maxLength={12} placeholder="Enter or generate" />
                  <button className="btn-primary" type="submit">Join / Create</button>
                </form>
              </div>
            </div>
          }
          {inCompetition && currentStage === 'lobby' && <LobbyControls />}
          {canvasModal && <DrawingModal />}
          {currentStage === 'draw' && !canvasModal &&
            <div>
              <h2>Waiting for drawings...</h2>
              <p>Others are drawing. Hang tight!</p>
            </div>}
          {currentStage === 'guess' && <GuessingSection />}
          {currentStage === 'vote' && <VotingSection />}
          {resultModal && <ResultModal />}
          {currentStage === 'results' && !resultModal && (
            <div>
              <h2>Winner: {players.find(p=>p.id===winner)?.name || "?"}</h2>
              <img src={winningDrawing?.url} alt="Winner Drawing" className="drawing-winner" />
              <div><b>Answer:</b> {correctAnswer}</div>
              <button className="btn-primary" onClick={resetGame}>OK</button>
            </div>
          )}
        </section>
      </main>
      {loginModal &&
        <div className="modal-backdrop">
          <form className="modal login-modal" onSubmit={handleUsernameSubmit}>
            <h2>Enter Username</h2>
            <input
              type="text"
              value={user}
              minLength={2}
              maxLength={18}
              autoFocus
              onChange={handleUserChange}
              placeholder="Username"
              required
            />
            <button className="btn-primary" type="submit">Continue</button>
          </form>
        </div>
      }
    </div>
  );
}

export default App;
