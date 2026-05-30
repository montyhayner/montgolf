// ------------------------------
// Utility: Toast Notifications
// ------------------------------
function showToast(message, type = "info") {
    const toast = document.getElementById("toast");
    toast.textContent = message;
    toast.className = "show " + type;

    setTimeout(() => {
        toast.className = toast.className.replace("show", "");
    }, 3000);
}

// ------------------------------
// Utility: Modal Controls
// ------------------------------
function openModal(id) {
    document.getElementById(id).style.display = "block";
}

function closeModal(id) {
    document.getElementById(id).style.display = "none";
}

// ------------------------------
// Load Golfers on Page Load
// ------------------------------
document.addEventListener("DOMContentLoaded", () => {
    loadGolfers();
    checkCoordinatorPrefill();
});

// ------------------------------
// Coordinator Prefill Logic
// ------------------------------
function checkCoordinatorPrefill() {
    const params = new URLSearchParams(window.location.search);
    if (params.get("addCoordinator") === "1") {
        openAddUserModal({
            first: params.get("first"),
            last: params.get("last"),
            email: params.get("email"),
            is_admin: 1
        });
    }
}

// ------------------------------
// Load Golfers
// ------------------------------
async function loadGolfers() {
    try {
        const res = await fetch("/admin/golfers/api");
        const golfers = await res.json();

        const tbody = document.getElementById("golfersBody");
        tbody.innerHTML = "";

        golfers.forEach(g => {
            const tr = document.createElement("tr");

            tr.innerHTML = `
                <td>${g.first_name}</td>
                <td>${g.last_name}</td>
                <td>${g.email}</td>
                <td>${g.is_admin ? "Yes" : "No"}</td>
                <td>${g.is_member ? "Member" : "Non-Member"}</td>
                <td>${g.subgroup || ""}</td>
                <td>${g.subgroup_number || ""}</td>
                <td>
                    <button class="btn-small" onclick="openEditUserModal(${g.id})">Edit</button>
                    <button class="btn-small" onclick="openResetPasswordModal(${g.id})">Reset PW</button>
                    <button class="btn-small btn-danger" onclick="openDeleteUserModal(${g.id})">Delete</button>
                </td>
            `;

            tbody.appendChild(tr);
        });

    } catch (err) {
        showToast("Error loading golfers", "error");
        console.error(err);
    }
}

// ------------------------------
// Add Golfer Modal
// ------------------------------
function openAddUserModal(prefill = null) {
    document.getElementById("add_first_name").value = prefill?.first || "";
    document.getElementById("add_last_name").value = prefill?.last || "";
    document.getElementById("add_email").value = prefill?.email || "";
    document.getElementById("add_password").value = "";

    document.getElementById("add_is_admin").checked = prefill?.is_admin ? true : false;
    document.getElementById("add_is_member").checked = false;

    document.getElementById("add_subgroup").value = "";
    document.getElementById("add_subgroup_number").value = "";

    openModal("addGolferModal");
}

// ------------------------------
// Add Golfer
// ------------------------------
async function addGolfer() {
    const data = {
        first_name: document.getElementById("add_first_name").value.trim(),
        last_name: document.getElementById("add_last_name").value.trim(),
        email: document.getElementById("add_email").value.trim(),
        password: document.getElementById("add_password").value,
        is_admin: document.getElementById("add_is_admin").checked ? 1 : 0,
        is_member: document.getElementById("add_is_member").checked ? 1 : 0,
        subgroup: document.getElementById("add_subgroup").value || null,
        subgroup_number: document.getElementById("add_subgroup_number").value || null
    };

    // Validation
    if (!data.first_name || !data.last_name || !data.email || !data.password) {
        showToast("All fields except subgroup are required", "error");
        return;
    }

    try {
        const res = await fetch("/admin/golfers/api", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data)
        });

        const result = await res.json();

        if (result.error) {
            showToast(result.error, "error");
            return;
        }

        closeModal("addGolferModal");
        showToast("Golfer added", "success");
        loadGolfers();

    } catch (err) {
        showToast("Error adding golfer", "error");
        console.error(err);
    }
}

// ------------------------------
// Edit Golfer Modal
// ------------------------------
async function openEditUserModal(id) {
    try {
        const res = await fetch(`/admin/golfers/api/${id}`);
        const g = await res.json();

        document.getElementById("edit_id").value = g.id;
        document.getElementById("edit_first_name").value = g.first_name;
        document.getElementById("edit_last_name").value = g.last_name;
        document.getElementById("edit_email").value = g.email;

        document.getElementById("edit_is_admin").checked = g.is_admin ? true : false;
        document.getElementById("edit_is_member").checked = g.is_member ? true : false;

        document.getElementById("edit_subgroup").value = g.subgroup || "";
        document.getElementById("edit_subgroup_number").value = g.subgroup_number || "";

        openModal("editGolferModal");

    } catch (err) {
        showToast("Error loading golfer", "error");
        console.error(err);
    }
}

// ------------------------------
// Save Golfer
// ------------------------------
async function saveGolfer() {
    const id = document.getElementById("edit_id").value;

    const data = {
        first_name: document.getElementById("edit_first_name").value.trim(),
        last_name: document.getElementById("edit_last_name").value.trim(),
        email: document.getElementById("edit_email").value.trim(),
        is_admin: document.getElementById("edit_is_admin").checked ? 1 : 0,
        is_member: document.getElementById("edit_is_member").checked ? 1 : 0,
        subgroup: document.getElementById("edit_subgroup").value || null,
        subgroup_number: document.getElementById("edit_subgroup_number").value || null
    };

    try {
        const res = await fetch(`/admin/golfers/api/${id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data)
        });

        const result = await res.json();

        if (result.error) {
            showToast(result.error, "error");
            return;
        }

        closeModal("editGolferModal");
        showToast("Golfer updated", "success");
        loadGolfers();

    } catch (err) {
        showToast("Error saving golfer", "error");
        console.error(err);
    }
}

// ------------------------------
// Reset Password Modal
// ------------------------------
function openResetPasswordModal(id) {
    document.getElementById("reset_id").value = id;
    document.getElementById("reset_password").value = "";
    document.getElementById("reset_password2").value = "";
    openModal("resetPasswordModal");
}

// ------------------------------
// Reset Password
// ------------------------------
async function resetPassword() {
    const id = document.getElementById("reset_id").value;
    const pw1 = document.getElementById("reset_password").value;
    const pw2 = document.getElementById("reset_password2").value;

    if (pw1 !== pw2) {
        showToast("Passwords do not match", "error");
        return;
    }

    try {
        const res = await fetch(`/admin/golfers/api/${id}/password`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ password: pw1 })
        });

        const result = await res.json();

        if (result.error) {
            showToast(result.error, "error");
            return;
        }

        closeModal("resetPasswordModal");
        showToast("Password reset", "success");

    } catch (err) {
        showToast("Error resetting password", "error");
        console.error(err);
    }
}

// ------------------------------
// Delete Golfer Modal
// ------------------------------
function openDeleteUserModal(id) {
    document.getElementById("delete_id").value = id;
    openModal("deleteGolferModal");
}

// ------------------------------
// Delete Golfer
// ------------------------------
async function deleteGolfer() {
    const id = document.getElementById("delete_id").value;

    try {
        const res = await fetch(`/admin/golfers/api/${id}`, {
            method: "DELETE"
        });

        const result = await res.json();

        if (result.error) {
            showToast(result.error, "error");
            return;
        }

        closeModal("deleteGolferModal");
        showToast("Golfer deleted", "success");
        loadGolfers();

    } catch (err) {
        showToast("Error deleting golfer", "error");
        console.error(err);
    }
}