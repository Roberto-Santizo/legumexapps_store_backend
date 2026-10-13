CREATE TABLE representative_clients (
    "representativeId" INTEGER NOT NULL,
    "clientId" INTEGER NOT NULL,
    CONSTRAINT representative_clients_pkey PRIMARY KEY ("representativeId", "clientId"),
    CONSTRAINT representative_clients_representative_fk FOREIGN KEY ("representativeId")
        REFERENCES customers(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT representative_clients_client_fk FOREIGN KEY ("clientId")
        REFERENCES clients(id) ON UPDATE CASCADE ON DELETE RESTRICT
);
CREATE INDEX representative_clients_client_idx ON representative_clients ("clientId");
