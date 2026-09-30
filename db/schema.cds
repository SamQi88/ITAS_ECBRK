namespace itas.ecbrk;

/* @assert.unique: { hash: [HASH_SHA256] } */
entity Documents {
  key ID_OPERAZIONE : UUID;
  NOME_DOCUMENTO    : String(255) not null;
  HASH_SHA256       : String(64) not null;
  DATA_CARICAMENTO  : Timestamp @cds.on.insert: $now;
}

entity Policies {
  key ID            : UUID;
  ID_OPERAZIONE     : UUID not null;
  NOME_DOCUMENTO    : String(255);
  DATA_EFFETTO      : Date;
  CONTRAENTE        : String(255);
  NUMERO_POLIZZA    : String(100);
  PREMI             : Decimal(15,2);
  PROVVIGIONI       : Decimal(15,2);
  DATA_INCASSO      : Date;
}
