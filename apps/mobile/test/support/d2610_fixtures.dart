/// DRMS 26/10 #1 "Instruksi pinjam antar proyek": `GET /expense-requests/{id}/project-loan-lenders` of a request whose
/// project account "Kas Contoh A" has Rp 10.000.000 free and needs Rp 30.000.000. Fictional PT and numbers.
Map<String, dynamic> pliJson({bool canInstruct = true, Map<String, dynamic>? pending}) => {
  'requestId': 42,
  'docNo': 'PB/DRMS/2610/0042',
  'title': 'Material',
  'companyId': 1,
  'borrowerProject': {'id': 5, 'code': 'Q-A', 'name': 'Proyek A'},
  'borrowerAccount': {'id': 3, 'name': 'Kas Contoh A', 'balance': 10000000, 'commitments': 0, 'available': 10000000},
  'needed': 30000000,
  'shortfall': 20000000,
  'minAmount': 20000000,
  'loanDate': '2026-10-26',
  'defaultDueDate': '2026-11-25',
  'canInstruct': canInstruct,
  'cannotReason': canInstruct ? null : 'Pinjaman PJ/DRMS/2610/0007 sudah diinstruksikan dan menunggu transfer Finance.',
  'pendingLoan': pending,
  'candidates': [
    {
      'project': {'id': 6, 'code': 'Q-B', 'name': 'Proyek B'},
      'account': {'id': 7, 'name': 'Kas Contoh B'},
      'available': 100000000,
      'eligible': true,
      'reason': null,
      'reasonText': null,
    },
    {
      'project': {'id': 8, 'code': 'Q-C', 'name': 'Proyek C'},
      'account': {'id': 9, 'name': 'Kas Contoh C'},
      'available': 2000000,
      'eligible': false,
      'reason': 'insufficient',
      'reasonText': 'Dana bebas akun kas kurang dari kekurangan pengajuan.',
    },
    {
      'project': {'id': 10, 'code': 'Q-N', 'name': 'Proyek N'},
      'account': null,
      'available': null,
      'eligible': false,
      'reason': 'no_account',
      'reasonText': 'Project ini belum punya akun kas (pusat biaya).',
    },
  ],
};
