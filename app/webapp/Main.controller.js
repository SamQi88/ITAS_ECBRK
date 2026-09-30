sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/ui/model/json/JSONModel",
  "sap/m/MessageBox"
], function (Controller, JSONModel, MessageBox) {
  "use strict";

  const EMPTY = "Carica un documento PDF";
  const amount = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" });

  return Controller.extend("itas.ecbrk.Main", {
    onInit: function () {
      this.getView().setModel(new JSONModel({ fileName: "", rows: [], count: 0, busy: false, emptyText: EMPTY }));
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "application/pdf,.pdf";
      input.style.display = "none";
      input.addEventListener("change", (e) => this._onFile(e.target.files[0]));
      document.body.appendChild(input);
      this._input = input;
    },

    onExit: function () {
      this._input.remove();
      if (this._url) URL.revokeObjectURL(this._url);
    },

    onPickFile: function () {
      this._input.value = "";
      this._input.click();
    },

    formatDate: function (iso) {
      if (!iso) return "";
      const [y, m, d] = iso.split("-");
      return d + "/" + m + "/" + y;
    },

    formatAmount: function (v) {
      return v === null || v === undefined ? "" : amount.format(v);
    },

    _onFile: async function (file) {
      if (!file) return;
      const model = this.getView().getModel();
      if (this._url) URL.revokeObjectURL(this._url);
      this._url = URL.createObjectURL(file);
      document.getElementById("pdfPreview").src = this._url;
      model.setData({ fileName: file.name, rows: [], count: 0, busy: true, emptyText: "Elaborazione in corso…" });

      const fail = (fn, msg) => {
        model.setData({ fileName: file.name, rows: [], count: 0, busy: false, emptyText: "Nessun dato" });
        fn.call(MessageBox, msg);
      };
      try {
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch("/upload", { method: "POST", body: fd });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          return fail(res.status === 409 ? MessageBox.warning : MessageBox.error,
            (body.error && body.error.message) || "Errore durante l'elaborazione");
        }
        model.setData({ fileName: file.name, rows: body.righe, count: body.righe.length, busy: false, emptyText: "Nessun dato" });
      } catch (e) {
        fail(MessageBox.error, "Impossibile contattare il server");
      }
    }
  });
});
