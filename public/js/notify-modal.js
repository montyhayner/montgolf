function openNotifyModal() {
  const modal = document.getElementById("notifyModal");
  if (!modal) return;

  // Reset steps every time modal opens
  const step1 = document.getElementById("notifyStep1");
  const step2 = document.getElementById("notifyStep2");

  if (step1) step1.style.display = "block";
  if (step2) step2.style.display = "none";

  modal.style.display = "block";
}

window.closeNotifyModal = function closeNotifyModal() {
  const modal = document.getElementById("notifyModal");
  if (modal) modal.style.display = "none";

  const step1 = document.getElementById("notifyStep1");
  const step2 = document.getElementById("notifyStep2");

  if (step1) step1.style.display = "block";
  if (step2) step2.style.display = "none";
};
