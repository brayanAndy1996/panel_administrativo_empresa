"use client";

import { useState } from "react";

interface RecoveryKeyDeliveryProps {
  recoveryKey: string;
  onContinue(): void;
}

export function RecoveryKeyDelivery({ recoveryKey, onContinue }: RecoveryKeyDeliveryProps) {
  const [acknowledged, setAcknowledged] = useState(false);

  return (
    <section className="form-card recovery-delivery" aria-labelledby="recovery-delivery-heading">
      <p className="eyebrow">Guárdala ahora</p>
      <h1 id="recovery-delivery-heading">Guarda tu clave de recuperación</h1>
      <p>Esta clave se muestra una sola vez. Guárdala fuera de este equipo; la aplicación no podrá volver a mostrarla.</p>
      <code className="recovery-key" data-testid="one-time-recovery-key">{recoveryKey}</code>
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={(event) => setAcknowledged(event.currentTarget.checked)}
        />
        Confirmo que guardé la clave en un lugar seguro
      </label>
      <button className="button button-primary" type="button" disabled={!acknowledged} onClick={onContinue}>
        Continuar
      </button>
    </section>
  );
}
