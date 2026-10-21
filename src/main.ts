import './style.css';

// Vaiheen 1 runko. Varsinaiset näkymät tulevat vaiheissa 3-5.
const app = document.querySelector<HTMLDivElement>('#app');
if (app) {
  app.innerHTML = `
    <div class="sim-banner" role="note">
      Pilotti: luvut perustuvat simuloituun dataan, eivät ole virallisia ennusteita.
    </div>
    <main>
      <h1>Riskiennuste RVS492</h1>
      <div class="card">
        <p>Perttelin VPK:n hälytys- ja riskiennusteen pilotti.</p>
        <p class="muted">Näkymät ovat rakenteilla.</p>
      </div>
    </main>
  `;
}
