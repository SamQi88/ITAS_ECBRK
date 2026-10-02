sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/ui/model/json/JSONModel",
  "sap/m/MessageBox"
], function (Controller, JSONModel, MessageBox) {
  "use strict";

  const EMPTY = "Carica un documento PDF";
  const amount = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR", useGrouping: "always" });

  // totale = somma degli importi letti dall'IA, arrotondata al centesimo (non il totale scritto nel PDF)
  const sum = (rows, key) => Math.round(rows.reduce((acc, r) => acc + (Number(r[key]) || 0), 0) * 100) / 100;

  return Controller.extend("itas.ecbrk.Main", {
    onInit: function () {
      this.getView().setModel(new JSONModel(this._state({})));
      this._loadModelLabel();
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

    // Parsing Confidence Score: verde da 90, arancione da 70, rosso sotto
    formatConfidenceText: function (c) {
      return c ? "Parsing Confidence Score: " + c.score + "%" : "";
    },

    formatConfidenceState: function (c) {
      if (!c) return "None";
      return c.score >= 90 ? "Success" : c.score >= 70 ? "Warning" : "Error";
    },

    formatConfidenceTooltip: function (c) {
      if (!c) return "";
      // "quadrati" per i premi, "quadrate" per le provvigioni
      const check = (label, ok, nok, t) => {
        if (!t) return label + ": totale non presente nel documento, controllo non eseguito";
        return t.quadra
          ? label + ": " + ok + " con il totale del documento (" + amount.format(t.documento) + ")"
          : label + ": " + nok + ", somma delle righe " + amount.format(t.righe) + " contro " + amount.format(t.documento) + " nel documento";
      };
      const nomi = { dataEffetto: "data effetto", contraente: "contraente", numeroPolizza: "numero polizza", premi: "premi", provvigioni: "provvigioni", dataIncasso: "data incasso" };
      const assenti = (c.campiAssenti || []).map((f) => nomi[f] || f);
      return "Indice di coerenza dell'estrazione, non una probabilità del modello. Completezza dei campi: " + c.completezza + "%. " +
        (assenti.length ? "Non presenti nel documento e quindi non considerati: " + assenti.join(", ") + ". " : "") +
        check("Premi", "quadrati", "NON quadrati", c.premi) + ". " + check("Provvigioni", "quadrate", "NON quadrate", c.provvigioni) + ".";
    },

    // stato completo della pagina: sempre un oggetto intero, per non mescolare righe di documenti diversi
    _state: function (partial) {
      return Object.assign({
        fileName: "", rows: [], count: 0, busy: false, emptyText: EMPTY,
        totalePremi: null, totaleProvvigioni: null, ritenuta: null, confidenza: null,
        modelLabel: this._modelLabel || ""
      }, partial);
    },

    // nome del modello IA in uso, in linguaggio naturale (viene dalla configurazione del server)
    _loadModelLabel: function () {
      fetch("/api/model")
        .then((res) => res.json())
        .then((info) => {
          this._modelLabel = info.label || "";
          this.getView().getModel().setProperty("/modelLabel", this._modelLabel);
        })
        .catch(() => {});
    },

    _onFile: async function (file) {
      if (!file) return;
      const model = this.getView().getModel();
      if (this._url) URL.revokeObjectURL(this._url);
      this._url = URL.createObjectURL(file);
      document.getElementById("pdfPreview").src = this._url;
      model.setData(this._state({ fileName: file.name, busy: true, emptyText: "Elaborazione in corso…" }));

      const fail = (fn, msg) => {
        model.setData(this._state({ fileName: file.name, emptyText: "Nessun dato" }));
        fn.call(MessageBox, msg);
      };
      try {
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch("/upload", { method: "POST", body: fd });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          return fail(MessageBox.error, (body.error && body.error.message) || "Errore durante l'elaborazione");
        }
        model.setData(this._state({
          fileName: file.name,
          rows: body.righe,
          count: body.righe.length,
          emptyText: "Nessun dato",
          totalePremi: sum(body.righe, "premi"),
          totaleProvvigioni: sum(body.righe, "provvigioni"),
          ritenuta: body.ritenutaAcconto === undefined ? null : body.ritenutaAcconto,
          confidenza: body.confidenza || null
        }));
        // documento già caricato: il file viene comunque elaborato, l'utente ne viene solo avvisato
        if (body.warning) MessageBox.warning(body.warning);
      } catch (e) {
        fail(MessageBox.error, "Impossibile contattare il server");
      }
    }
  });
});
