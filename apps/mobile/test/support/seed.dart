import 'package:proyekkas/features/expense/domain/draft.dart';
import 'package:proyekkas/features/expense/domain/request_status.dart';

/// Fictional seed mirroring the structure of client form 228/PB-DRMS/20/IX/2026 (ADR 0010 Example B):
/// 3 lines 600.000 + 677.000 + 170.500 = Rp 1.447.500. Names/ids are fictional.
DraftRequest seedDraft({RequestType type = RequestType.reimburse, bool withReceipts = true}) => DraftRequest(
  clientUuid: '0192f6d0-aaaa-7bbb-8ccc-000000000100',
  type: type,
  title: 'Pengajuan Reimburse Ops Palangka Banjar keperluan Service Tronton',
  costCenterId: 7,
  neededDate: '2026-09-22',
  requesterIds: const [11, 12],
  bankAccountId: 21,
  lines: [
    DraftLine(
      clientUuid: '0192f6d0-aaaa-7bbb-8ccc-000000000011',
      no: 1,
      description: 'BBM Hilux Banjarmasin-Palangka',
      qty: 1,
      uomId: 3,
      total: 600000,
      categoryId: 1,
      vehicleId: 5,
      receipts: [
        if (withReceipts)
          const DraftReceipt(
            clientUuid: '0192f6d0-aaaa-7bbb-8ccc-000000000301',
            receiptNo: '7654321',
            vendorName: 'SPBU 61234501 Pertamina',
            receiptDate: '2026-09-21',
            receiptTime: '11:42',
            amount: 600000,
            mediaUuid: '0192f6d0-aaaa-7bbb-8ccc-000000000201',
          ),
      ],
    ),
    DraftLine(
      clientUuid: '0192f6d0-aaaa-7bbb-8ccc-000000000012',
      no: 2,
      description: 'Penginapan',
      qty: 2,
      uomId: 4,
      unitPrice: 339000,
      total: 677000,
      categoryId: 2,
      receipts: [
        if (withReceipts)
          const DraftReceipt(
            clientUuid: '0192f6d0-aaaa-7bbb-8ccc-000000000302',
            receiptNo: '9876543210',
            vendorName: 'POP! Hotel Banjarmasin (Traveloka)',
            receiptDate: '2026-09-20',
            amount: 676876,
            mediaUuid: '0192f6d0-aaaa-7bbb-8ccc-000000000202',
          ),
      ],
    ),
    DraftLine(
      clientUuid: '0192f6d0-aaaa-7bbb-8ccc-000000000013',
      no: 3,
      description: 'Makan siang',
      total: 170500,
      categoryId: 3,
      receipts: [
        if (withReceipts)
          const DraftReceipt(
            clientUuid: '0192f6d0-aaaa-7bbb-8ccc-000000000303',
            receiptNo: 'TX0101.0001.000123',
            vendorName: 'Soto "Mas Joko"',
            receiptDate: '2026-09-21',
            receiptTime: '10:47',
            amount: 170500,
            mediaUuid: '0192f6d0-aaaa-7bbb-8ccc-000000000203',
          ),
      ],
    ),
  ],
);
