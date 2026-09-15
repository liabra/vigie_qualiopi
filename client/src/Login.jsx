export default function Login({ flash, googleConfigured }) {
  return (
    <main className="login">
      <div className="card login-card">
        <h1>Vigie Qualiopi</h1>
        <p className="muted">Suivi de la conformité au Référentiel national qualité.</p>
        {flash && <p className={"flash " + flash.type}>{flash.texte}</p>}
        {googleConfigured ? (
          <a className="btn primary" href="/auth/google/login">Se connecter avec Google</a>
        ) : (
          <p className="flash erreur">Google OAuth n'est pas encore configuré sur le serveur.</p>
        )}
      </div>
    </main>
  );
}
