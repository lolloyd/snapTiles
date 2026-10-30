import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import {
  BrowserRouter,
  Link,
  NavLink,
  Route,
  Routes,
  useNavigate,
  useParams,
} from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  Check,
  CheckCheck,
  ChevronRight,
  Copy,
  Download,
  ExternalLink,
  Grid2X2,
  ImagePlus,
  LayoutDashboard,
  LoaderCircle,
  LogOut,
  Plus,
  QrCode,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Trophy,
  Users,
  X,
} from "lucide-react";
import QRCode from "qrcode";
import type {
  Game,
  GridSize,
  Player,
  Prompt,
  PublicGame,
  Session,
  WinCondition,
} from "../../shared/domain";
import {
  api,
  compressImage,
  dateLabel,
  errorMessage,
  RequestError,
} from "./lib";

type Identity = {
  user: { name: string; roles: string[] } | null;
  local: boolean;
};
const tokenKey = "snaptiles-session";

function Brand() {
  return (
    <Link className="brand" to="/" aria-label="SnapTiles home">
      <span className="brand-mark">
        <Grid2X2 size={23} strokeWidth={2.8} />
      </span>
      SnapTiles<span className="brand-dot">.</span>
    </Link>
  );
}
function Busy({ label = "Loading" }: { label?: string }) {
  return (
    <span className="busy" role="status">
      <LoaderCircle className="spin" size={18} />
      {label}
    </span>
  );
}
function ErrorNotice({ message }: { message: string }) {
  return message ? (
    <div className="notice error" role="alert">
      {message}
    </div>
  ) : null;
}
function Status({ status }: { status: string }) {
  return (
    <span className={`status ${status === "ACTIVE" ? "active" : ""}`}>
      <span />
      {status === "ACTIVE" ? "Live" : "Closed"}
    </span>
  );
}
function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="empty">
      <Camera size={30} />
      <p>{children}</p>
    </div>
  );
}

function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog
      ref={dialog}
      onCancel={onClose}
      onClick={(event) => {
        if (event.target === dialog.current) onClose();
      }}
      aria-label={title}
    >
      <div className="modal-heading">
        <h2>{title}</h2>
        <button className="icon-button" title="Close dialog" onClick={onClose}>
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}

function Header({ identity }: { identity: Identity | null }) {
  return (
    <header className="topbar">
      <Brand />
      <nav aria-label="Main navigation">
        {identity?.local && (
          <span className="local-label">Local workspace</span>
        )}
        <NavLink to="/" end>
          Join a room
        </NavLink>
        {identity && !identity.user ? (
          <a href="/.auth/login/aad?post_login_redirect_uri=/admin">
            <LayoutDashboard size={16} />
            <span>Organizer</span>
          </a>
        ) : (
          <NavLink to="/admin">
            <LayoutDashboard size={16} />
            <span>Organizer</span>
          </NavLink>
        )}
      </nav>
    </header>
  );
}

function Join() {
  const { code } = useParams();
  const [roomCode, setRoomCode] = useState(code || "");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  async function join(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const session = await api<Session>("public/join", {
        method: "POST",
        body: { roomCode, displayName: name },
      });
      sessionStorage.setItem(tokenKey, session.participantToken);
      navigate("/play/board");
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="join-page">
      <div className="photo-ribbon" aria-hidden="true">
        <img
          src="https://images.unsplash.com/photo-1511632765486-a01980e01a18?auto=format&fit=crop&w=700&q=80"
          alt=""
        />
        <div className="ribbon-label">
          <Camera size={28} />
          <span>
            Good company.
            <br />
            Great moments.
          </span>
        </div>
        <img
          src="https://images.unsplash.com/photo-1500534623283-312aade485b7?auto=format&fit=crop&w=600&q=80"
          alt=""
        />
        <img
          src="https://images.unsplash.com/photo-1498837167922-ddd27525d352?auto=format&fit=crop&w=600&q=80"
          alt=""
        />
      </div>
      <section className="join-content">
        <div className="eyebrow">
          <span className="small-square" />
          PHOTO SCAVENGER BINGO
        </div>
        <h1>SnapTiles</h1>
        <p className="intro">Your next good moment is on the board.</p>
        <form className="join-form" onSubmit={join}>
          <label>
            Room code
            <input
              value={roomCode}
              onChange={(event) =>
                setRoomCode(event.target.value.toUpperCase())
              }
              placeholder="ABC234"
              required
              minLength={6}
              maxLength={6}
              pattern="[A-Za-z2-9]{6}"
              autoCapitalize="characters"
              autoComplete="off"
              className="room-input"
            />
          </label>
          <label>
            Your name
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Alex M."
              required
              maxLength={40}
              autoComplete="nickname"
            />
          </label>
          <ErrorNotice message={error} />
          <button className="primary wide" disabled={busy || !name.trim()}>
            {busy ? (
              <Busy label="Joining" />
            ) : (
              <>
                Join room
                <ArrowRight size={18} />
              </>
            )}
          </button>
        </form>
        {sessionStorage.getItem(tokenKey) && (
          <Link className="text-link resume" to="/play/board">
            Back to my board
            <ArrowRight size={16} />
          </Link>
        )}
        <div className="join-footer">
          <ShieldCheck size={17} />
          No account. Just your name and a camera.
        </div>
      </section>
      <footer className="page-footer">
        <span>MAKE A MOMENT OF IT.</span>
        <Link to="/admin">
          Hosting an event?
          <ExternalLink size={14} />
        </Link>
      </footer>
    </main>
  );
}

function AdminLayout({
  identity,
  children,
}: {
  identity: Identity | null;
  children: ReactNode;
}) {
  if (!identity)
    return (
      <main className="loading-page">
        <Busy />
      </main>
    );
  if (!identity.user)
    return (
      <main className="auth-page">
        <ShieldCheck size={36} />
        <h1>Organizer sign in</h1>
        <p>Sign in with your organizer account to manage your events.</p>
        <a
          className="primary"
          href="/.auth/login/aad?post_login_redirect_uri=/admin"
        >
          Sign in with Microsoft
          <ArrowRight size={18} />
        </a>
        <p className="muted">Your account must have the admin role.</p>
      </main>
    );
  return (
    <div className="workspace">
      <aside className="sidebar">
        <div className="eyebrow">WORKSPACE</div>
        <NavLink to="/admin" end>
          <LayoutDashboard size={18} />
          My events
        </NavLink>
        <NavLink to="/admin/new">
          <Plus size={18} />
          New event
        </NavLink>
        <div className="sidebar-bottom">
          <span className="avatar">{identity.local ? "L" : "O"}</span>
          <div>
            <strong>{identity.user.name}</strong>
            <small>
              {identity.local ? "Development only" : "Event organizer"}
            </small>
          </div>
          {!identity.local && (
            <a
              href="/.auth/logout?post_logout_redirect_uri=/"
              className="icon-button"
              title="Sign out"
            >
              <LogOut size={17} />
            </a>
          )}
        </div>
      </aside>
      <main className="workspace-main">{children}</main>
    </div>
  );
}

function Events() {
  const [games, setGames] = useState<Game[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("ALL");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    api<{ games: Game[] }>("games", { signal: controller.signal })
      .then((result) => setGames(result.games))
      .catch((failure) => {
        if (!controller.signal.aborted) setError(errorMessage(failure));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [refresh]);
  const visible = games.filter(
    (game) =>
      (filter === "ALL" || game.status === filter) &&
      `${game.title} ${game.roomCode}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  return (
    <>
      <div className="breadcrumb">
        Workspace
        <ChevronRight size={14} />
        Events
      </div>
      <div className="page-heading">
        <div>
          <div className="eyebrow">LET'S GET TOGETHER</div>
          <h1>
            My events<span className="heading-count">{games.length}</span>
          </h1>
          <p className="muted">
            A little friendly competition. A lot of shared moments.
          </p>
        </div>
        <Link className="primary" to="/admin/new">
          <Plus size={18} />
          Create event
        </Link>
      </div>
      <div className="stats-band">
        <div>
          <span className="stat-icon green">
            <Grid2X2 />
          </span>
          <div>
            <strong>{games.length}</strong>
            <span>Total events</span>
          </div>
        </div>
        <div>
          <span className="stat-icon coral">
            <Sparkles />
          </span>
          <div>
            <strong>
              {games.filter((game) => game.status === "ACTIVE").length}
            </strong>
            <span>Live right now</span>
          </div>
        </div>
        <div>
          <span className="stat-icon gold">
            <CheckCheck />
          </span>
          <div>
            <strong>
              {games.filter((game) => game.status === "CLOSED").length}
            </strong>
            <span>Wrapped up</span>
          </div>
        </div>
      </div>
      <div className="list-toolbar">
        <div className="tabs" role="tablist" aria-label="Event status">
          {[
            ["ALL", "All events"],
            ["ACTIVE", "Live"],
            ["CLOSED", "Closed"],
          ].map(([value, label]) => (
            <button
              key={value}
              role="tab"
              aria-selected={filter === value}
              onClick={() => setFilter(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="toolbar-actions">
          <label className="search-field">
            <Search size={17} />
            <input
              aria-label="Search events"
              placeholder="Search events"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <button
            className="icon-button"
            title="Refresh events"
            onClick={() => setRefresh(refresh + 1)}
          >
            <RefreshCw size={17} />
          </button>
        </div>
      </div>
      <ErrorNotice message={error} />
      {loading ? (
        <Busy label="Loading events" />
      ) : visible.length === 0 ? (
        <Empty>
          {games.length ? (
            "No events match your search."
          ) : (
            <>
              No events yet.{" "}
              <Link to="/admin/new">Create your first event.</Link>
            </>
          )}
        </Empty>
      ) : (
        <div className="event-list">
          {visible.map((game) => (
            <Link
              className="event-row"
              to={`/admin/games/${game.id}`}
              key={game.id}
            >
              <span
                className={`event-art ${game.gridSize === 5 ? "gold" : "green"}`}
              >
                <Grid2X2 size={27} />
              </span>
              <div className="event-info">
                <h2>{game.title}</h2>
                <p>
                  {game.gridSize} x {game.gridSize}
                  <span>·</span>
                  {game.winCondition === "LINE"
                    ? "First line wins"
                    : "Full board"}
                  <span>·</span>
                  {dateLabel(game.createdAt)}
                </p>
              </div>
              <code className="room-code">{game.roomCode}</code>
              <Status status={game.status} />
              <ChevronRight size={19} />
            </Link>
          ))}
        </div>
      )}
    </>
  );
}

function CreateEvent() {
  const [title, setTitle] = useState("");
  const [gridSize, setGridSize] = useState<GridSize>(3);
  const [winCondition, setWinCondition] = useState<WinCondition>("LINE");
  const [prompts, setPrompts] = useState<string[]>([]);
  const [library, setLibrary] = useState<Prompt[]>([]);
  const [category, setCategory] = useState("All");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [librarySlot, setLibrarySlot] = useState(0);
  const navigate = useNavigate();
  useEffect(() => {
    api<{ prompts: Prompt[] }>("prompts")
      .then((result) => {
        setLibrary(result.prompts);
        setPrompts(result.prompts.slice(0, 25).map((prompt) => prompt.text));
      })
      .catch((failure) => setError(errorMessage(failure)));
  }, []);
  function changePrompt(index: number, text: string) {
    setPrompts((current) =>
      Array.from({ length: 25 }, (_, position) =>
        position === index ? text : current[position] || "",
      ),
    );
  }
  async function create(event: FormEvent) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const result = await api<{ game: Game }>("games", {
        method: "POST",
        body: {
          title,
          gridSize,
          winCondition,
          prompts: prompts.slice(0, gridSize ** 2),
        },
      });
      navigate(`/admin/games/${result.game.id}?created=1`);
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Link className="back-link" to="/admin">
        <ArrowLeft size={16} />
        All events
      </Link>
      <div className="page-heading">
        <div>
          <div className="eyebrow">MAKE IT YOURS</div>
          <h1>Create an event</h1>
        </div>
      </div>
      <form onSubmit={create} className="create-layout">
        <div>
          <section className="form-section">
            <h2>
              <span className="step-number">01</span>The essentials
            </h2>
            <label>
              Event name
              <input
                placeholder="Friday team adventure"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                required
                maxLength={100}
              />
            </label>
            <div className="field-row">
              <fieldset>
                <legend>Board size</legend>
                <div className="segments">
                  {([3, 5] as const).map((size) => (
                    <label key={size}>
                      <input
                        type="radio"
                        name="size"
                        checked={gridSize === size}
                        onChange={() => setGridSize(size)}
                      />
                      <span>
                        {size} x {size}
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <fieldset>
                <legend>Win condition</legend>
                <select
                  aria-label="Win condition"
                  value={winCondition}
                  onChange={(event) =>
                    setWinCondition(event.target.value as WinCondition)
                  }
                >
                  <option value="LINE">Complete a line</option>
                  <option value="BLACKOUT">Fill the board</option>
                </select>
              </fieldset>
            </div>
          </section>
          <section className="form-section">
            <div className="section-heading">
              <h2>
                <span className="step-number">02</span>The photo prompts
              </h2>
              <button
                type="button"
                className="text-link"
                onClick={() => setLibraryOpen(true)}
              >
                <Plus size={16} />
                Prompt library
              </button>
            </div>
            <div className="prompt-editor">
              {Array.from({ length: gridSize ** 2 }, (_, index) => (
                <label key={index}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <input
                    aria-label={`Prompt ${index + 1}`}
                    required
                    maxLength={140}
                    placeholder="A moment to capture"
                    value={prompts[index] || ""}
                    onChange={(event) =>
                      changePrompt(index, event.target.value)
                    }
                  />
                </label>
              ))}
            </div>
          </section>
          <ErrorNotice message={error} />
          <div className="form-actions">
            <Link className="secondary" to="/admin">
              Cancel
            </Link>
            <button
              className="primary"
              disabled={
                busy ||
                !title.trim() ||
                prompts
                  .slice(0, gridSize ** 2)
                  .some((prompt) => !prompt.trim()) ||
                prompts.length < gridSize ** 2
              }
            >
              {busy ? (
                <Busy label="Creating" />
              ) : (
                <>
                  Create event
                  <ArrowRight size={17} />
                </>
              )}
            </button>
          </div>
        </div>
        <aside className="board-preview">
          <div className="eyebrow">THEIR NEXT ADVENTURE</div>
          <h2>{title || "Your event, their moments."}</h2>
          <div className={`mini-board size-${gridSize}`}>
            {Array.from({ length: gridSize ** 2 }, (_, index) => (
              <div key={index}>
                {gridSize === 3 ? (
                  <>
                    <Camera size={16} />
                    <span>{prompts[index] || "Your prompt"}</span>
                  </>
                ) : (
                  index + 1
                )}
              </div>
            ))}
          </div>
          <span className="preview-note">
            <Grid2X2 size={15} />
            {gridSize ** 2} photo moments
          </span>
        </aside>
      </form>
      {libraryOpen && (
        <Modal title="Prompt library" onClose={() => setLibraryOpen(false)}>
          <label>
            Replace tile
            <select
              value={librarySlot}
              onChange={(event) => setLibrarySlot(Number(event.target.value))}
            >
              {Array.from({ length: gridSize ** 2 }, (_, index) => (
                <option key={index} value={index}>
                  {index + 1}: {prompts[index] || "Empty tile"}
                </option>
              ))}
            </select>
          </label>
          <label>
            Category
            <select
              value={category}
              onChange={(event) => setCategory(event.target.value)}
            >
              {[
                "All",
                ...new Set(library.map((prompt) => prompt.category)),
              ].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <div className="library-list">
            {library
              .filter(
                (prompt) => category === "All" || prompt.category === category,
              )
              .map((prompt) => (
                <button
                  key={prompt.id}
                  onClick={() => {
                    changePrompt(
                      Math.min(librarySlot, gridSize ** 2 - 1),
                      prompt.text,
                    );
                    setLibraryOpen(false);
                  }}
                >
                  <span>
                    <small>{prompt.category}</small>
                    {prompt.text}
                  </span>
                  <Plus size={17} />
                </button>
              ))}
          </div>
        </Modal>
      )}
    </>
  );
}

function ShareRoom({ game, onClose }: { game: Game; onClose: () => void }) {
  const [qr, setQr] = useState("");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const url = `${window.location.origin}/play/${game.roomCode}`;
  useEffect(() => {
    QRCode.toDataURL(url, {
      width: 360,
      margin: 2,
      color: { dark: "#174c3c", light: "#ffffff" },
    })
      .then(setQr)
      .catch((failure) => setError(errorMessage(failure)));
  }, [url]);
  return (
    <Modal title="Invite your people" onClose={onClose}>
      <div className="share-room">
        <Status status={game.status} />
        <h3>{game.title}</h3>
        {qr ? (
          <img
            className="qr-image"
            src={qr}
            alt={`QR code for room ${game.roomCode}`}
          />
        ) : (
          <Busy label="Creating QR code" />
        )}
        <span className="muted">Room code</span>
        <strong className="share-code">{game.roomCode}</strong>
        <div className="share-actions">
          <button
            className="secondary"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(url);
                setCopied(true);
              } catch {
                setError("Could not copy. Select the link below instead.");
              }
            }}
          >
            {copied ? <Check size={17} /> : <Copy size={17} />}
            {copied ? "Copied" : "Copy link"}
          </button>
          {qr && (
            <a
              className="secondary"
              href={qr}
              download={`snaptiles-${game.roomCode}.png`}
            >
              <Download size={17} />
              QR code
            </a>
          )}
        </div>
        <input
          aria-label="Participant invite link"
          readOnly
          value={url}
          onFocus={(event) => event.target.select()}
        />
        <ErrorNotice message={error} />
      </div>
    </Modal>
  );
}

function ReviewEvent() {
  const { id } = useParams();
  const [game, setGame] = useState<Game | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [cursor, setCursor] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [share, setShare] = useState(
    new URLSearchParams(location.search).has("created"),
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmStatus, setConfirmStatus] = useState(false);
  const [busy, setBusy] = useState(false);
  const [photo, setPhoto] = useState<{ url: string; text: string } | null>(
    null,
  );
  async function load(append = false) {
    try {
      const result = await api<{
        game: Game;
        players: Player[];
        cursor?: string;
      }>(
        `admin/games/${id}/submissions${append && cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
      );
      setGame(result.game);
      setPlayers((current) =>
        append ? [...current, ...result.players] : result.players,
      );
      setCursor(result.cursor);
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setLoading(false);
    }
  }
  const loadFromEffect = useEffectEvent(() => {
    void load();
  });
  useEffect(() => {
    const initial = setTimeout(loadFromEffect, 0);
    const interval = setInterval(loadFromEffect, 5 * 60_000);
    return () => {
      clearTimeout(initial);
      clearInterval(interval);
    };
  }, [id]);
  const selected = players.find((player) => player.id === selectedId);
  async function changeStatus() {
    if (!game) return;
    setBusy(true);
    setError("");
    try {
      const result = await api<{ game: Game }>(`admin/games/${id}`, {
        method: "PATCH",
        body: { status: game.status === "ACTIVE" ? "CLOSED" : "ACTIVE" },
      });
      setGame(result.game);
      setConfirmStatus(false);
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Link className="back-link" to="/admin">
        <ArrowLeft size={16} />
        All events
      </Link>
      <ErrorNotice message={error} />
      {!game ? (
        loading ? (
          <Busy />
        ) : (
          <Empty>Event unavailable.</Empty>
        )
      ) : (
        <>
          <div className="page-heading">
            <div>
              <div className="eyebrow">EVENT ROOM / {game.roomCode}</div>
              <h1>{game.title}</h1>
              <div className="inline-meta">
                <Status status={game.status} />
                <span>
                  {game.gridSize} x {game.gridSize}
                </span>
                <span>
                  {game.winCondition === "LINE"
                    ? "Complete a line"
                    : "Fill the board"}
                </span>
              </div>
            </div>
            <button className="primary" onClick={() => setShare(true)}>
              <QrCode size={18} />
              Invite players
            </button>
          </div>
          <div className="review-toolbar">
            <h2>
              <Users size={20} />
              Players
              <span className="heading-count">
                {players.length}
                {cursor ? "+" : ""}
              </span>
            </h2>
            <div className="toolbar-actions">
              <button
                className="icon-button"
                title="Refresh submissions"
                disabled={loading}
                onClick={() => void load()}
              >
                <RefreshCw size={18} className={loading ? "spin" : ""} />
              </button>
              <button
                className="secondary"
                onClick={() => setConfirmStatus(true)}
              >
                {game.status === "ACTIVE" ? "Close room" : "Reopen room"}
              </button>
            </div>
          </div>
          {players.length === 0 ? (
            <Empty>No players yet. Your room is ready to share.</Empty>
          ) : (
            <div className="players-grid">
              {players.map((player) => (
                <button
                  className="player-card"
                  key={player.id}
                  onClick={() => setSelectedId(player.id)}
                >
                  <div className="player-card-heading">
                    <span className="avatar">
                      {player.displayName.slice(0, 1).toUpperCase()}
                    </span>
                    <strong>{player.displayName}</strong>
                    {player.hasWon && <Trophy size={18} className="trophy" />}
                  </div>
                  <div className={`contact-sheet size-${game.gridSize}`}>
                    {game.promptSlots.map((slot) => {
                      const tile = player.tiles.find(
                        (record) => record.index === slot.index,
                      );
                      return (
                        <span key={slot.index}>
                          {tile?.photoUrl ? (
                            <img
                              src={tile.photoUrl}
                              alt={slot.text}
                              loading="lazy"
                            />
                          ) : (
                            <Camera size={15} />
                          )}
                        </span>
                      );
                    })}
                  </div>
                  <div className="player-progress">
                    <span>
                      {player.tiles.length}/{game.gridSize ** 2} photos
                    </span>
                    <span>
                      {player.hasWon
                        ? "Bingo!"
                        : `${player.completedLines} lines`}
                    </span>
                  </div>
                  <progress
                    max={game.gridSize ** 2}
                    value={player.tiles.length}
                  />
                </button>
              ))}
            </div>
          )}
          {cursor && (
            <button
              className="secondary load-more"
              disabled={loading}
              onClick={() => void load(true)}
            >
              {loading ? <Busy /> : "Load more players"}
            </button>
          )}
          {share && (
            <ShareRoom
              game={game}
              onClose={() => {
                setShare(false);
                history.replaceState(null, "", location.pathname);
              }}
            />
          )}
          {confirmStatus && (
            <Modal
              title={
                game.status === "ACTIVE"
                  ? "Close this room?"
                  : "Reopen this room?"
              }
              onClose={() => setConfirmStatus(false)}
            >
              <p>
                {game.status === "ACTIVE"
                  ? "Players will no longer be able to join or submit photos. Existing boards remain available for review."
                  : "Players will be able to join and submit photos again."}
              </p>
              <div className="form-actions">
                <button
                  className="secondary"
                  onClick={() => setConfirmStatus(false)}
                >
                  Cancel
                </button>
                <button
                  className="primary"
                  disabled={busy}
                  onClick={changeStatus}
                >
                  {busy ? <Busy /> : "Confirm"}
                </button>
              </div>
            </Modal>
          )}
          {selected && (
            <Modal
              title={`${selected.displayName}'s board`}
              onClose={() => setSelectedId(null)}
            >
              <div className={`bingo-board review-board size-${game.gridSize}`}>
                {game.promptSlots.map((slot) => {
                  const tile = selected.tiles.find(
                    (record) => record.index === slot.index,
                  );
                  return (
                    <button
                      key={slot.index}
                      className={`bingo-tile ${tile ? "filled" : ""}`}
                      disabled={!tile?.photoUrl}
                      onClick={() =>
                        tile?.photoUrl &&
                        setPhoto({ url: tile.photoUrl, text: slot.text })
                      }
                    >
                      {tile?.photoUrl ? (
                        <img src={tile.photoUrl} alt={slot.text} />
                      ) : (
                        <Camera size={20} />
                      )}
                      <span>{slot.text}</span>
                    </button>
                  );
                })}
              </div>
            </Modal>
          )}
          {photo && (
            <Modal title={photo.text} onClose={() => setPhoto(null)}>
              <img className="full-photo" src={photo.url} alt={photo.text} />
            </Modal>
          )}
        </>
      )}
    </>
  );
}

function UploadTile({
  game,
  player,
  index,
  token,
  onSaved,
  onClose,
}: {
  game: PublicGame;
  player: Player;
  index: number;
  token: string;
  onSaved: (player: Player) => void;
  onClose: () => void;
}) {
  const tile = player.tiles.find((record) => record.index === index);
  const [file, updateFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  function setFile(next: File | null) {
    updateFile(next);
    setPreview(next ? URL.createObjectURL(next) : "");
  }
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState("");
  const [error, setError] = useState("");
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );
  async function upload() {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      setStage("Preparing photo");
      const compressed = await compressImage(file);
      setStage("Uploading photo");
      const ticket = await api<{ uploadUrl: string; blobName: string }>(
        "public/uploads/sas",
        { method: "POST", body: { tileIndex: index }, token },
      );
      const response = await fetch(ticket.uploadUrl, {
        method: "PUT",
        headers: {
          "content-type": "image/jpeg",
          "x-ms-blob-type": "BlockBlob",
        },
        body: compressed,
      });
      if (!response.ok)
        throw new Error("The photo upload failed. Please try again.");
      setStage("Saving your tile");
      const result = await api<{ player: Player }>("public/submit-tile", {
        method: "POST",
        body: { tileIndex: index, blobName: ticket.blobName },
        token,
      });
      onSaved(result.player);
      onClose();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={game.promptSlots[index].text}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <div className="upload-content">
        {preview || tile?.photoUrl ? (
          <img
            className="upload-preview"
            src={preview || tile?.photoUrl}
            alt={game.promptSlots[index].text}
          />
        ) : (
          <div className="upload-placeholder">
            <Camera size={44} />
          </div>
        )}
        {game.status === "ACTIVE" ? (
          <>
            <label className="file-picker secondary">
              <ImagePlus size={18} />
              {tile || file ? "Choose another photo" : "Choose a photo"}
              <input
                aria-label="Choose a photo"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                capture="environment"
                disabled={busy}
                onChange={(event) => {
                  setFile(event.target.files?.[0] || null);
                  setError("");
                }}
              />
            </label>
            <small className="muted">JPEG, PNG, or WebP · up to 20 MB</small>
            <ErrorNotice message={error} />
            <button
              className="primary wide"
              disabled={!file || busy}
              onClick={upload}
            >
              {busy ? (
                <Busy label={stage} />
              ) : (
                <>
                  <Check size={18} />
                  {tile ? "Replace photo" : "Save tile"}
                </>
              )}
            </button>
          </>
        ) : (
          <p className="muted">This room is closed.</p>
        )}
      </div>
    </Modal>
  );
}

function PlayerBoard() {
  const [token] = useState(() => sessionStorage.getItem(tokenKey) || "");
  const [game, setGame] = useState<PublicGame | null>(null);
  const [player, setPlayer] = useState<Player | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(Boolean(token));
  const [selected, setSelected] = useState<number | null>(null);
  const [leave, setLeave] = useState(false);
  const navigate = useNavigate();
  async function refresh() {
    try {
      const session = await api<{ game: PublicGame; player: Player }>(
        "public/session",
        { token },
      );
      setGame(session.game);
      setPlayer(session.player);
      setError("");
    } catch (failure) {
      if (failure instanceof RequestError && failure.status === 401)
        sessionStorage.removeItem(tokenKey);
      setError(errorMessage(failure));
    } finally {
      setLoading(false);
    }
  }
  const refreshFromEffect = useEffectEvent(() => {
    void refresh();
  });
  useEffect(() => {
    if (!token) return;
    const initial = setTimeout(refreshFromEffect, 0);
    const interval = setInterval(refreshFromEffect, 30_000);
    return () => {
      clearTimeout(initial);
      clearInterval(interval);
    };
  }, [token]);
  if (!token)
    return (
      <main className="auth-page">
        <Camera size={36} />
        <h1>Your board awaits.</h1>
        <Link className="primary" to="/">
          Join a room
          <ArrowRight size={17} />
        </Link>
      </main>
    );
  return (
    <main className="player-page">
      <ErrorNotice message={error} />
      {loading ? (
        <Busy label="Loading your board" />
      ) : game && player ? (
        <>
          <div className="player-topline">
            <span className="eyebrow">ROOM {game.roomCode}</span>
            <button
              className="icon-button"
              title="Leave this session"
              onClick={() => setLeave(true)}
            >
              <LogOut size={18} />
            </button>
          </div>
          <h1>{game.title}</h1>
          <div className="player-subheading">
            <span>Hey, {player.displayName}</span>
            <Status status={game.status} />
            <button
              className="icon-button"
              title="Refresh board"
              onClick={() => void refresh()}
            >
              <RefreshCw size={16} />
            </button>
          </div>
          {player.hasWon && (
            <div className="win-banner" role="status">
              <Trophy size={28} />
              <div>
                <strong>That's a bingo!</strong>
                <span>
                  {game.winCondition === "BLACKOUT"
                    ? "Every moment captured."
                    : `${player.completedLines} completed ${player.completedLines === 1 ? "line" : "lines"}. Make it a full board?`}
                </span>
              </div>
              <Sparkles size={25} />
            </div>
          )}
          {game.status === "CLOSED" && (
            <div className="notice">
              This room has wrapped up. Your moments are still here.
            </div>
          )}
          <div className="board-progress">
            <span>
              <strong>{player.tiles.length}</strong> / {game.gridSize ** 2}{" "}
              moments
            </span>
            <span>
              {game.winCondition === "LINE"
                ? "One line to win"
                : "Fill the board to win"}
            </span>
            <progress max={game.gridSize ** 2} value={player.tiles.length} />
          </div>
          <div className={`bingo-board size-${game.gridSize}`}>
            {game.promptSlots.map((slot) => {
              const tile = player.tiles.find(
                (record) => record.index === slot.index,
              );
              return (
                <button
                  key={slot.index}
                  className={`bingo-tile ${tile ? "filled" : ""}`}
                  title={slot.text}
                  onClick={() => setSelected(slot.index)}
                  disabled={game.status === "CLOSED" && !tile}
                >
                  <span className="tile-number">
                    {String(slot.index + 1).padStart(2, "0")}
                  </span>
                  {tile?.photoUrl ? (
                    <>
                      <img src={tile.photoUrl} alt={slot.text} />
                      <span className="tile-check">
                        <Check size={15} />
                      </span>
                    </>
                  ) : (
                    <Camera
                      size={game.gridSize === 5 ? 19 : 26}
                      strokeWidth={1.6}
                    />
                  )}
                  <span className="tile-prompt">{slot.text}</span>
                </button>
              );
            })}
          </div>
          {selected !== null && (
            <UploadTile
              game={game}
              player={player}
              index={selected}
              token={token}
              onSaved={setPlayer}
              onClose={() => setSelected(null)}
            />
          )}
          {leave && (
            <Modal title="Leave this session?" onClose={() => setLeave(false)}>
              <p>
                Your submitted photos will stay in the event. Joining again
                creates a new board; this session will be removed from this
                browser tab.
              </p>
              <div className="form-actions">
                <button className="secondary" onClick={() => setLeave(false)}>
                  Stay here
                </button>
                <button
                  className="primary"
                  onClick={() => {
                    sessionStorage.removeItem(tokenKey);
                    navigate("/");
                  }}
                >
                  Leave session
                </button>
              </div>
            </Modal>
          )}
          <footer className="board-footer">
            <Camera size={16} />
            Good moments make great boards.
          </footer>
        </>
      ) : (
        <div className="empty">
          <Link to="/">
            Join your room again
            <ArrowRight size={16} />
          </Link>
          <button className="secondary" onClick={() => void refresh()}>
            Retry
          </button>
        </div>
      )}
    </main>
  );
}

export default function App() {
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api<Identity>("me")
      .then(setIdentity)
      .catch((failure) => setError(errorMessage(failure)));
  }, []);
  return (
    <BrowserRouter>
      <Header identity={identity} />
      {error && (
        <div className="global-error">
          <ErrorNotice message={error} />
          <button className="secondary" onClick={() => location.reload()}>
            Retry connection
          </button>
        </div>
      )}
      <Routes>
        <Route path="/" element={<Join />} />
        <Route path="/play/board" element={<PlayerBoard />} />
        <Route path="/play/:code" element={<Join />} />
        <Route
          path="/admin"
          element={
            <AdminLayout identity={identity}>
              <Events />
            </AdminLayout>
          }
        />
        <Route
          path="/admin/new"
          element={
            <AdminLayout identity={identity}>
              <CreateEvent />
            </AdminLayout>
          }
        />
        <Route
          path="/admin/games/:id"
          element={
            <AdminLayout identity={identity}>
              <ReviewEvent />
            </AdminLayout>
          }
        />
        <Route
          path="*"
          element={
            <main className="auth-page">
              <h1>Not this way.</h1>
              <Link className="primary" to="/">
                Back to SnapTiles
                <ArrowRight size={17} />
              </Link>
            </main>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}
