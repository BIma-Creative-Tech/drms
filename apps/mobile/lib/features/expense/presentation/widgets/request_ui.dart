import 'package:flutter/material.dart';

import '../../../../shared/icons/iconsax.dart';
import '../../../../shared/widgets/pk_ui.dart';
import '../../domain/request_status.dart';

/// D2510: pill tone of a request status — draft neutral, waiting for a decision / revision warn, in progress info,
/// approved / paid / done ok, rejected / cancelled bad.
PkTone requestStatusTone(RequestStatus s) => switch (s) {
  RequestStatus.draft || RequestStatus.unknown => PkTone.neutral,
  RequestStatus.pendingAck ||
  RequestStatus.pendingApproval ||
  RequestStatus.receiptRevision ||
  RequestStatus.lpjRevision => PkTone.warn,
  RequestStatus.receiptsVerified || RequestStatus.receiptsComplete || RequestStatus.lpjSubmitted => PkTone.info,
  RequestStatus.approved ||
  RequestStatus.transferred ||
  RequestStatus.lpjVerified ||
  RequestStatus.completed => PkTone.ok,
  RequestStatus.rejected || RequestStatus.cancelled => PkTone.bad,
};

/// Leading icon chip of a request row: Pengajuan Baru (advance) or Reimburse; vendor / antar-PT payments get their own
/// glyph.
Widget requestTypeChip(RequestType type, {PayeeType payee = PayeeType.karyawan, double size = 40}) => PkIconChip(
  icon: switch (payee) {
    PayeeType.vendor => Icons.storefront_outlined,
    PayeeType.ptGrup => Icons.apartment_outlined,
    PayeeType.karyawan => type == RequestType.advance ? PkIcons.advance : PkIcons.reimburse,
  },
  tone: type == RequestType.advance ? PkTone.info : PkTone.ok,
  size: size,
);
