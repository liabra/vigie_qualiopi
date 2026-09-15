import { useEffect, useState } from "react";
import { api } from "./api.js";

export default function DriveStatus() {
  const [s, setS] = useState(null);
  const [err, setErr] = useState(null);

  const load = () => api("/api/drive/status").then(setS).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);

  async function disconnect() {
    if (!window.confirm("Déconnecter le Google Drive ?")) return;
    await api("/api/drive/disconnect", { method: "POST" }).catch((e) => setErr(e.message));
    load();
  }

  if (err) return <section className="card drive"><p className="flash erreur">Drive : {err}</p></section>;
  if (!s) return null;
  return (
    <section className="card drive">
      <div>
        <strong>Google Drive</strong>{" "}
        {s.connected
          ? <span className="pill ok">Connecté{s.lectureSeule ? " · lecture seule" : ""}</span>
          : <span className="pill off">Non connecté</span>}
        <div className="muted small">
          Compte : {s.verifie || s.compte}
          {s.erreur && <> · <span className="text-erreur">{s.erreur}</span></>}
        </div>
      </div>
      {s.configured && (s.connected
        ? <button className="btn" onClick={disconnect}>Déconnecter</button>
        : <a className="btn primary" href="/auth/google/drive">Connecter le Drive</a>)}
    </section>
  );
}
