export default function QueueNotice() {
  return (
    <div className="alert info small">
      Las subidas se envían a la cola de Magento y quedan registradas a tu nombre en{" "}
      <b>System › Action Logs › Bulk Actions</b>. Magento las procesa con su cron, así que pueden tardar unos minutos;
      acá vas a ver el resultado de cada imagen.
    </div>
  );
}
