using itas.ecbrk as db from '../db/schema';

@path: '/odata/archivio'
service ArchivioService {
  @readonly entity Documents as projection on db.Documents;
  @readonly entity Policies  as projection on db.Policies;
}
