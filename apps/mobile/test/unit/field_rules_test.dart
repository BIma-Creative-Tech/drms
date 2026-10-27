import 'package:flutter_test/flutter_test.dart';
import 'package:proyekkas/features/auth/domain/user_profile.dart';
import 'package:proyekkas/features/expense/data/expense_mappers.dart';
import 'package:proyekkas/features/field_reports/application/field_providers.dart';
import 'package:proyekkas/features/field_reports/domain/field_models.dart';
import 'package:proyekkas/features/field_reports/domain/field_rules.dart';
import 'package:proyekkas/features/field_reports/presentation/field_conflict_screen.dart' show serviceTypesOfCopy;
import 'package:proyekkas/features/sync/domain/sync_models.dart';

/// FR1 (ADR 0020, requirements v1.3) APK rules: dates, HM, hours, kind-specific fields, sync payloads, error
/// texts, /me capabilities. Fictional data only.
const today = '2026-10-09';

FieldDraft service(ServiceContent c, {String date = today, int? serverId}) => FieldDraft(
  clientUuid: 'sv-1',
  type: FieldReportType.serviceReport,
  companyId: 3,
  projectId: 41,
  projectLabel: 'K-001 — Sewa Kalteng Coal',
  reportDate: date,
  content: c,
  serverId: serverId,
  serverRev: serverId == null ? null : 2,
);

FieldDraft timesheet(TimesheetContent c, {String date = today, int? serverId, int serverPhotoCount = 0}) => FieldDraft(
  clientUuid: 'ts-1',
  type: FieldReportType.unitTimesheet,
  companyId: 3,
  projectId: 41,
  reportDate: date,
  content: c,
  serverPhotoCount: serverPhotoCount,
  serverId: serverId,
  serverRev: serverId == null ? null : 1,
);

FieldDraft activity(ActivityContent c, {String date = today, int? serverId}) => FieldDraft(
  clientUuid: 'as-1',
  type: FieldReportType.aftersalesActivity,
  companyId: 3,
  projectId: 52,
  reportDate: date,
  content: c,
  serverId: serverId,
  serverRev: serverId == null ? null : 3,
);

const okService = ServiceContent(
  unitId: 9,
  unitLabel: 'EX-01',
  hourMeter: 1025,
  startTime: '08:30',
  endTime: '13:15',
  serviceTypeIds: [7, 8],
  serviceTypeNames: {7: 'Perbaikan', 8: 'Inspeksi'},
  complaint: 'Boom turun sendiri',
  action: 'Ganti seal kit boom',
  spareparts: [
    PartLine(name: 'Seal kit boom', partNo: '707-99-47570', qty: 1, uom: 'set'),
    PartLine(),
  ],
  unitStatusAfter: UnitStatus.menungguPart,
  beforePhotos: ['p-1', 'p-2'],
  afterPhotos: ['p-3'],
);

const okTimesheet = TimesheetContent(
  unitId: 9,
  unitLabel: 'EX-01',
  hmStart: 1023,
  hmEnd: 1031.5,
  workHours: 8,
  standbyHours: 1.5,
  breakdownHours: 0,
  operatorName: 'Slamet',
  fuelLiters: 120,
  location: 'Pit 3',
  hmPhoto: 'hm-1',
  previousHmEnd: 1023,
);

void main() {
  group('dates (not in the future, ≤ 14 days back)', () {
    test('today, 14 days back ok; tomorrow / 15 days refused', () {
      expect(reportDateError(today, today), isNull);
      expect(reportDateError('2026-09-25', today), isNull);
      expect(reportDateError('2026-10-10', today), contains('masa depan'));
      expect(reportDateError('2026-09-24', today), contains('14 hari'));
      expect(allowedReportDates(today), hasLength(15));
      expect(allowedReportDates(today).first, today);
      expect(allowedReportDates(today).last, '2026-09-25');
    });

    test('timesheet window (user 2026-10-24): server min date of the caller, else 14 days', () {
      // PM / Direktur: back to the earliest contract start; a reporter's server min = today − 14
      expect(timesheetMinDate(today, '2026-08-01'), '2026-08-01');
      expect(timesheetMinDate(today, null), '2026-09-25');
      expect(timesheetMinDate(today, 'kemarin'), '2026-09-25');
      expect(timesheetMinDate(today, '2026-10-20'), today, reason: 'never after today');
      expect(reportDateError('2026-08-01', today, minDate: '2026-08-01'), isNull);
      expect(reportDateError('2026-07-31', today, minDate: '2026-08-01'), contains('paling awal 2026-08-01'));
      expect(reportDateError('2026-10-10', today, minDate: '2026-08-01'), contains('masa depan'));
      final dates = allowedReportDates(today, minDate: '2026-08-01');
      expect((dates.first, dates.last, dates.length), (today, '2026-08-01', 70));
      final old = timesheet(okTimesheet, date: '2026-09-01');
      expect(validateTimesheet(old, today: today)['date'], contains('14 hari'));
      expect(validateTimesheet(old, today: today, minDate: '2026-08-01'), isEmpty);
    });

    test('today in the company zone (WITA / WIB)', () {
      final utc = DateTime.utc(2026, 10, 9, 16, 30); // 00:30 WITA on the 10th, 23:30 WIB on the 9th
      expect(todayIn('Asia/Makassar', now: utc), '2026-10-10');
      expect(todayIn('Asia/Jakarta', now: utc), '2026-10-09');
    });
  });

  group('hour meter', () {
    test('HM floor: unit last HM (not after the date) and readings on/before the date', () {
      expect(hmFloor(lastHourMeter: 1023, lastHourMeterAt: '2026-10-08T10:00:00Z', date: today), 1023);
      // a later reading (backdated report) does not count
      expect(hmFloor(lastHourMeter: 1040, lastHourMeterAt: '2026-10-09', date: '2026-10-05'), isNull);
      expect(
        hmFloor(
          lastHourMeter: 1000,
          lastHourMeterAt: '2026-10-01',
          date: today,
          readings: const [('2026-10-08', 1023), ('2026-10-10', 1050)],
        ),
        1023,
      );
    });

    test('HM awal prefill = HM akhir of the latest earlier timesheet, else the unit last HM', () {
      const marks = [
        TimesheetMark(unitId: 9, reportDate: '2026-10-07', hmStart: 1008, hmEnd: 1015),
        TimesheetMark(
          unitId: 9,
          reportDate: '2026-10-08',
          hmStart: 1015,
          hmEnd: 1023,
          operatorName: 'Slamet',
          location: 'Pit 3',
        ),
        TimesheetMark(unitId: 9, reportDate: today, hmStart: 1023, hmEnd: 1031),
        TimesheetMark(unitId: 10, reportDate: '2026-10-08', hmStart: 500, hmEnd: 508),
      ];
      final p = previousHmEnd(unitId: 9, date: today, marks: marks, lastHourMeter: 1031, lastHourMeterAt: today);
      expect(p.hm, 1023);
      expect(p.date, '2026-10-08');
      final none = previousHmEnd(
        unitId: 11,
        date: today,
        marks: marks,
        lastHourMeter: 77,
        lastHourMeterAt: '2026-10-01',
      );
      expect(none.hm, 77);
      expect(previousHmEnd(unitId: 11, date: today, marks: marks).hm, isNull);
      // weekly HM (user 2026-10-24): a later timesheet without HM is skipped, still the "Salin dari kemarin" source
      final skip = [
        const TimesheetMark(unitId: 12, reportDate: '2026-10-01', hmStart: 2000, hmEnd: 2009),
        const TimesheetMark(unitId: 12, reportDate: '2026-10-05'),
      ];
      expect(previousHmEnd(unitId: 12, date: today, marks: skip).hm, 2009);
      expect(copySource(unitId: 12, date: today, marks: skip)!.reportDate, '2026-10-05');
      final src = copySource(unitId: 9, date: today, marks: marks)!;
      expect((src.operatorName, src.location), ('Slamet', 'Pit 3'));
    });

    test('service HM below the floor is blocked (HM_DECREASED), not for an own edit', () {
      expect(validateService(service(okService), today: today, floor: 1023), isEmpty);
      final low = service(
        const ServiceContent(
          unitId: 9,
          hourMeter: 1020,
          serviceTypeIds: [8],
          action: 'Cek',
          unitStatusAfter: UnitStatus.siap,
        ),
      );
      expect(validateService(low, today: today, floor: 1023)['hourMeter'], contains('1.023'));
      expect(validateService(service(low.service, serverId: 77), today: today, floor: 1023)['hourMeter'], isNull);
    });
  });

  group('service report', () {
    test('required: unit, type, action ≥ 3, status; end after start; parts need qty', () {
      final e = validateService(
        service(
          const ServiceContent(
            startTime: '13:00',
            endTime: '08:00',
            spareparts: [PartLine(name: 'Filter')],
          ),
        ),
        today: today,
      );
      expect(e.keys, containsAll(['unit', 'serviceType', 'action', 'unitStatusAfter', 'endTime', 'parts']));
      expect(e['serviceType'], 'Pilih minimal satu jenis servis.');
      expect(validateService(service(okService), today: '2026-10-30'), contains('date'));
    });

    test('jenis servis: one or several master types; a legacy code of an APK < 0.8.0 still counts', () {
      ServiceContent types(List<int> ids, {String? legacy}) => ServiceContent(
        unitId: 9,
        serviceTypeIds: ids,
        legacyServiceType: legacy,
        action: 'Ganti seal',
        unitStatusAfter: UnitStatus.siap,
      );
      expect(validateService(service(types(const [7])), today: today), isEmpty);
      expect(validateService(service(types(const [7, 8, 9])), today: today), isEmpty);
      final none = validateService(service(types(const [])), today: today);
      expect(none['serviceType'], 'Pilih minimal satu jenis servis.');
      expect(validateService(service(types(const [], legacy: 'perbaikan')), today: today), isEmpty);
    });

    test('photos ≤ 25 (owner 2026-10-17) incl. those already on the server', () {
      expect(FieldReportType.serviceReport.maxPhotos, 25);
      expect(validateService(service(okService).copyWith(serverPhotoCount: 22), today: today), isEmpty);
      final d = service(okService).copyWith(serverPhotoCount: 23); // 23 + 3 new
      expect(validateService(d, today: today)['photos'], 'Maksimal 25 foto.');
      expect(fieldErrorMessage('PHOTO_LIMIT', null), contains('servis 25'));
    });

    test('sync payload of a new report: identity, content, before+after photo placeholders; blank rows dropped', () {
      final p = fieldSyncPayload(service(okService));
      expect(p['report_client_uuid'], 'sv-1');
      expect(p['project_id'], 41);
      expect(p['unit_id'], 9);
      expect(p['report_date'], today);
      expect(p['service_type_ids'], [7, 8]);
      expect(p.containsKey('service_type'), isFalse, reason: 'the new APK never sends the legacy code');
      expect(p['unit_status_after'], 'menunggu_part');
      expect(p['hour_meter'], 1025);
      expect(p['spareparts'], [
        {'name': 'Seal kit boom', 'part_no': '707-99-47570', 'qty': 1.0, 'uom': 'set', 'note': null},
      ]);
      expect(p[progressPhotosPlaceholderKey], ['p-1', 'p-2', 'p-3']);
      expect(p.containsKey('reason'), isFalse);
      // resolved by the sync engine after the upload
      final r = resolveMediaIds(p, {'p-1': 901, 'p-2': 902, 'p-3': 903})!;
      expect(r['photo_media_ids'], [901, 902, 903]);
      expect(r.containsKey(progressPhotosPlaceholderKey), isFalse);
    });

    test('edit payload: server id, no identity fields, reason', () {
      final p = fieldSyncPayload(service(okService, serverId: 77).copyWith(reason: 'Salah ketik HM'));
      expect(p['report_id'], 77);
      expect(p['service_type_ids'], [7, 8], reason: 'edit sends the ids too');
      expect(p.keys, isNot(contains('project_id')));
      expect(p.keys, isNot(contains('unit_id')));
      expect(p.keys, isNot(contains('report_client_uuid')));
      expect(p['reason'], 'Salah ketik HM');
    });

    test('spare part no. of a loaded row is kept in the payload (input hidden, value not dropped)', () {
      final p = fieldSyncPayload(service(okService, serverId: 77));
      expect((p['spareparts'] as List).single['part_no'], '707-99-47570');
    });

    test('APK < 0.8.0 draft: stored enum code → legacy; mapped to the PT type of the same code when cached', () {
      final old = ServiceContent.fromJson({'unitId': 9, 'serviceType': 'perbaikan', 'action': 'Ganti seal'});
      expect(old.serviceTypeIds, isEmpty);
      expect((old.legacyServiceType, old.serviceTypeLabel()), ('perbaikan', 'perbaikan'));
      final p = fieldSyncPayload(service(old));
      expect(p['service_type'], 'perbaikan');
      expect(p.containsKey('service_type_ids'), isFalse);
      const types = [
        ServiceType(id: 70, companyId: 3, code: 'perbaikan', name: 'Perbaikan', active: false),
        ServiceType(id: 71, companyId: 3, code: 'perbaikan', name: 'Perbaikan (baru)'),
        ServiceType(id: 72, companyId: 3, code: 'inspeksi', name: 'Inspeksi'),
      ];
      expect(matchLegacyServiceType(types, 'perbaikan')!.id, 71, reason: 'an active type first');
      expect(matchLegacyServiceType(types.take(1), 'perbaikan')!.id, 70);
      expect(matchLegacyServiceType(types, 'pemasangan'), isNull);
      final mapped = mapLegacyServiceType(p, types);
      expect(mapped['service_type_ids'], [71]);
      expect(mapped.containsKey('service_type'), isFalse);
      expect(mapped['action'], 'Ganti seal');
      expect(mapLegacyServiceType(p, const []), same(p), reason: 'no cache yet: the legacy code is sent');
      final fresh = fieldSyncPayload(service(okService));
      expect(mapLegacyServiceType(fresh, types), same(fresh));
      // the new content round-trips (local JSON)
      final back = ServiceContent.fromJson(okService.toJson());
      expect(back.serviceTypeIds, [7, 8]);
      expect(back.serviceTypeNames, {7: 'Perbaikan', 8: 'Inspeksi'});
      expect(back.legacyServiceType, isNull);
      expect(service(okService).summary, 'EX-01 · Perbaikan, Inspeksi · HM 1.025');
      expect(service(okService).summaryWith({7: 'Perbaikan berat'}), 'EX-01 · Perbaikan berat, Inspeksi · HM 1.025');
      expect(const ServiceContent(serviceTypeIds: [5]).serviceTypeLabel(), '#5');
    });

    test('server record: serviceTypes → ids + names of the edit draft; older server: legacy code', () {
      final r = FieldRecord(FieldReportType.serviceReport, {
        'id': 77,
        'companyId': 3,
        'project': {'id': 41},
        'unit': {'id': 9, 'unitCode': 'EX-01'},
        'reportDate': today,
        'serviceTypes': [
          {'id': 7, 'code': 'perbaikan', 'name': 'Perbaikan', 'active': true},
          {'id': 9, 'code': 'las', 'name': 'Las', 'active': false},
        ],
        'serviceType': 'perbaikan',
        'spareparts': [
          {'name': 'Seal kit', 'partNo': '707-99', 'qty': 1, 'uom': 'set'},
        ],
      });
      expect(r.title, 'EX-01 · Perbaikan, Las');
      final c = r.toDraft(clientUuid: 'u').service;
      expect(c.serviceTypeIds, [7, 9]);
      expect(c.serviceTypeNames, {7: 'Perbaikan', 9: 'Las'});
      expect(c.legacyServiceType, isNull);
      expect(c.spareparts.single.partNo, '707-99');
      final old = FieldRecord(FieldReportType.serviceReport, {'id': 1, 'serviceType': 'inspeksi'});
      expect(old.title, 'inspeksi');
      expect(old.toDraft(clientUuid: 'v').service.legacyServiceType, 'inspeksi');
      final las = ServiceType.fromJson({'id': 9, 'company': 3, 'code': 'las', 'name': 'Las', 'active': false});
      expect((las.id, las.companyId, las.code, las.name, las.active), (9, 3, 'las', 'Las', false));
    });

    test('conflict screen: server copy service_type_ids → cached names, "#id" when unknown, else legacy code', () {
      final copy = {
        'service_type_ids': [7, 99],
        'service_type': 'perbaikan',
      };
      expect(serviceTypesOfCopy(copy, {7: 'Perbaikan'}), 'Perbaikan, #99');
      expect(serviceTypesOfCopy({'service_type': 'perbaikan'}, const {}), 'perbaikan');
      expect(serviceTypesOfCopy(const {}, const {}), '');
    });
  });

  group('timesheet', () {
    test('valid; hints: HM gap and breakdown ≥ 4 h suggestion', () {
      expect(validateTimesheet(timesheet(okTimesheet), today: today), isEmpty);
      expect(timesheetHints(okTimesheet), (hmGap: false, suggestService: false));
      final gap = TimesheetContent.fromJson({
        ...okTimesheet.toJson(),
        'hmStart': 1020,
        'breakdownHours': 4,
        'breakdownReason': 'Hidrolik',
      });
      expect(timesheetHints(gap), (hmGap: true, suggestService: true));
      expect(validateTimesheet(timesheet(gap), today: today), isEmpty, reason: 'HM_GAP is a flag, not a refusal');
    });

    test('HM akhir < awal, Σ > 24, breakdown without reason, HM photo required', () {
      final bad = TimesheetContent.fromJson({
        ...okTimesheet.toJson(),
        'hmEnd': 1000,
        'workHours': 20,
        'standbyHours': 3,
        'breakdownHours': 2,
        'hmPhoto': null,
      });
      final e = validateTimesheet(timesheet(bad), today: today);
      expect(e['hmEnd'], contains('lebih kecil'));
      expect(e['hours'], contains('25'));
      expect(e['breakdownReason'], isNotNull);
      expect(e['photos'], contains('wajib'));
      // an own edit keeps the server's HM photo
      expect(
        validateTimesheet(timesheet(bad, serverId: 5, serverPhotoCount: 1), today: today),
        isNot(contains('photos')),
      );
    });

    test('HM optional (user 2026-10-24): none ok, both-or-none, photo only with HM', () {
      const none = TimesheetContent(unitId: 9, unitLabel: 'EX-01', workHours: 8);
      expect(validateTimesheet(timesheet(none), today: today), isEmpty);
      expect(none.hasHm, isFalse);
      final onlyStart = validateTimesheet(
        timesheet(const TimesheetContent(unitId: 9, hmStart: 1023, workHours: 8, hmPhoto: 'hm-1')),
        today: today,
      );
      expect(onlyStart['hmEnd'], 'HM akhir wajib bila HM awal diisi.');
      final onlyEnd = validateTimesheet(
        timesheet(const TimesheetContent(unitId: 9, hmEnd: 1031, workHours: 8, hmPhoto: 'hm-1')),
        today: today,
      );
      expect(onlyEnd['hmStart'], 'HM awal wajib bila HM akhir diisi.');
      const noPhoto = TimesheetContent(unitId: 9, hmStart: 1023, hmEnd: 1031, workHours: 8);
      expect(validateTimesheet(timesheet(noPhoto), today: today)['photos'], 'Foto meter HM wajib bila HM diisi.');
      // an edit of a timesheet without photo that now gets HM needs the photo too
      expect(validateTimesheet(timesheet(noPhoto, serverId: 5), today: today), contains('photos'));
      // a photo without HM is accepted
      const photoOnly = TimesheetContent(unitId: 9, workHours: 8, hmPhoto: 'hm-1');
      expect(validateTimesheet(timesheet(photoOnly), today: today), isEmpty);
      expect(timesheetHints(const TimesheetContent(previousHmEnd: 1023)).hmGap, isFalse);
    });

    test('a prefilled HM awal the user did not touch counts only together with HM akhir', () {
      expect(effectiveHmStart(hmStart: 1023, hmEnd: null, touched: false), isNull);
      expect(effectiveHmStart(hmStart: 1023, hmEnd: 1031, touched: false), 1023);
      expect(effectiveHmStart(hmStart: 1023, hmEnd: null, touched: true), 1023);
    });

    test('payload without HM: new timesheet omits HM and photo; an edit clears HM with null and may add a photo', () {
      const none = TimesheetContent(unitId: 9, unitLabel: 'EX-01', workHours: 8);
      final p = fieldSyncPayload(timesheet(none));
      expect(p.keys, isNot(contains('hm_start')));
      expect(p.keys, isNot(contains('hm_end')));
      expect(p['work_hours'], 8);
      expect(resolveMediaIds(p, const {})!.keys, isNot(contains('hm_photo_media_id')));
      final cleared = fieldSyncPayload(timesheet(none, serverId: 5, serverPhotoCount: 1));
      expect((cleared['hm_start'], cleared['hm_end']), (null, null));
      expect(cleared.containsKey('hm_start'), isTrue);
      expect(cleared.keys, isNot(contains(hmPhotoPlaceholderKey)));
      final added = fieldSyncPayload(timesheet(okTimesheet, serverId: 5));
      expect(added[hmPhotoPlaceholderKey], 'hm-1', reason: 'a timesheet without photo may get one on an edit');
      expect(resolveMediaIds(added, {'hm-1': 951})!['hm_photo_media_id'], 951);
    });

    test('payload: HM photo placeholder → hm_photo_media_id; an edit never replaces the stored photo', () {
      final p = fieldSyncPayload(timesheet(okTimesheet));
      expect(p['timesheet_client_uuid'], 'ts-1');
      expect(p['hm_start'], 1023);
      expect(p['hm_end'], 1031.5);
      expect(p['standby_hours'], 1.5);
      expect(p['breakdown_reason'], isNull);
      expect(p[hmPhotoPlaceholderKey], 'hm-1');
      final r = resolveMediaIds(p, {'hm-1': 950})!;
      expect(r['hm_photo_media_id'], 950);
      expect(resolveMediaIds(p, const {}), isNull, reason: 'photo not uploaded yet');
      final edit = fieldSyncPayload(timesheet(okTimesheet, serverId: 5, serverPhotoCount: 1));
      expect(edit['timesheet_id'], 5);
      expect(edit.keys, isNot(contains(hmPhotoPlaceholderKey)));
      expect(edit.keys, isNot(contains('report_date')));
    });
  });

  group('aftersales activity', () {
    test('pengiriman needs an open PO; follow-up not before the date', () {
      final e = validateActivity(
        activity(const ActivityContent(clientId: 4, kind: ActivityKind.pengiriman)),
        today: today,
      );
      expect(e['relatesTo'], isNotNull);
      final f = validateActivity(
        activity(const ActivityContent(clientId: 4, kind: ActivityKind.penawaran, followUpDate: '2026-10-01')),
        today: today,
      );
      expect(f['followUpDate'], isNotNull);
      expect(validateActivity(activity(const ActivityContent()), today: today).keys, containsAll(['client', 'kind']));
    });

    test('payload: pengiriman carries relates_to + po_delivered; value only as typed; no follow-up', () {
      const c = ActivityContent(
        clientId: 4,
        clientName: 'CV Maju Jaya',
        kind: ActivityKind.pengiriman,
        docNo: 'SJ-0441',
        items: [
          PartLine(name: 'Seal kit boom', qty: 1, uom: 'set'),
          PartLine(name: 'Filter oli', qty: 4, uom: 'pcs'),
        ],
        value: 3100000,
        relatesTo: 907,
        poDelivered: true,
        followUpDate: '2026-10-14',
        receiver: 'Budi',
        photos: ['sj-1'],
      );
      final p = fieldSyncPayload(activity(c));
      expect(p['activity_client_uuid'], 'as-1');
      expect(p['client_id'], 4);
      expect(p['kind'], 'pengiriman');
      expect(p['relates_to'], 907);
      expect(p['po_delivered'], isTrue);
      expect(p['follow_up_date'], isNull);
      expect(p['value'], 3100000);
      expect(p['items'], [
        {'name': 'Seal kit boom', 'part_no': null, 'qty': 1.0, 'uom': 'set'},
        {'name': 'Filter oli', 'part_no': null, 'qty': 4.0, 'uom': 'pcs'},
      ]);
      final offer = fieldSyncPayload(
        activity(const ActivityContent(clientId: 4, kind: ActivityKind.penawaran, followUpDate: '2026-10-14')),
      );
      expect(offer['follow_up_date'], '2026-10-14');
      expect(offer.keys, isNot(contains('relates_to')));
      expect(offer.keys, isNot(contains('po_delivered')));
    });
  });

  group('server JSON', () {
    test('contract unit: rate / basis / minimum hours never parsed', () {
      final cu = FieldContractUnit.fromJson({
        'id': 1,
        'companyId': 3,
        'projectId': 41,
        'unit': {'id': 9, 'label': 'EX-01 Excavator', 'unitCode': 'EX-01'},
        'startDate': '2026-10-01',
        'endDate': null,
        'active': true,
        'rateBasis': 'per_jam',
        'rate': 350000,
        'minHoursPerMonth': 200,
        'ratesVisible': true,
      });
      expect(cu.code, 'EX-01');
      expect(cu.activeOn('2026-09-30'), isFalse);
      expect(cu.activeOn(today), isTrue);
      expect(FieldContractUnit.fromJson(const {}).startDate, '');
    });

    test('unit search by code / plate; open PO label; record → edit draft', () {
      final u = FieldUnit.fromJson({
        'id': 9,
        'companyId': 3,
        'label': 'EX-01 Excavator',
        'unitCode': 'EX-01',
        'plateDisplay': null,
        'type': 'Excavator',
        'brandModel': 'PC200-8',
        'owner': 'pelanggan',
        'client': {'id': 4, 'name': 'CV Maju Jaya'},
        'status': 'menunggu_part',
        'lastHourMeter': 1023,
      });
      expect(u.matches('ex01'), isTrue);
      expect(u.matches('pc200'), isTrue);
      expect(u.matches('DZ'), isFalse);
      expect((u.customerOwned, u.clientName, u.status), (true, 'CV Maju Jaya', UnitStatus.menungguPart));
      final po = FieldOpenPo.fromJson({
        'id': 907,
        'companyId': 3,
        'project': {'id': 52},
        'client': {'id': 4, 'name': 'CV Maju Jaya'},
        'activityDate': '2026-10-04',
        'docNo': 'PO-0907',
        'items': [
          {'name': 'Seal kit', 'qty': 1, 'uom': 'set'},
          {'name': 'Filter', 'qty': 4, 'uom': 'pcs'},
        ],
        'value': 4250000,
        'valueVisible': true,
        'poStatus': 'belum_kirim',
        'ageDays': 5,
      });
      expect(po.label, 'PO-0907 · Seal kit 1 set, Filter 4 pcs (5 hari)');
      final r = FieldRecord(FieldReportType.unitTimesheet, {
        'id': 5,
        'companyId': 3,
        'project': {'id': 41, 'code': 'K-001', 'name': 'Sewa Kalteng Coal'},
        'unit': {'id': 9, 'unitCode': 'EX-01'},
        'reportDate': today,
        'hmStart': 1023,
        'hmEnd': 1031.5,
        'workHours': 8,
        'hmPhoto': {'id': 950},
        'rev': 2,
        'editable': true,
        'editableUntil': '2026-10-10T02:00:00Z',
        'clientUuid': 'ts-uuid',
        'flags': ['HM_GAP'],
      });
      final d = r.toDraft(clientUuid: r.clientUuid!);
      expect((d.serverId, d.serverRev, d.serverPhotoCount, d.projectLabel), (5, 2, 1, 'K-001 — Sewa Kalteng Coal'));
      expect(d.timesheet.hmEnd, 1031.5);
      expect(r.subtitle, startsWith('HM 1.023 → 1.031,5'));
    });

    test('aftersales value only when the server shows it', () {
      final hidden = FieldRecord(FieldReportType.aftersalesActivity, {'id': 1, 'value': 99, 'valueVisible': false});
      expect(hidden.value, isNull);
      final mine = FieldRecord(FieldReportType.aftersalesActivity, {'id': 1, 'value': 99, 'valueVisible': true});
      expect(mine.value, 99);
    });

    test('sync result: field server copy; FR1 codes → clear Indonesian text', () {
      final r = SyncItemResult.fromJson({
        'client_uuid': 'x',
        'status': 'conflict',
        'server_unit_timesheet': {'id': 5, 'rev': 3},
      });
      expect(r.serverField, {'id': 5, 'rev': 3});
      String msg(String code) =>
          rejectionMessage([SyncError(code: code, message: 'server text')], type: SyncItemType.unitTimesheetUpsert);
      expect(msg('FEATURE_DISABLED'), contains('belum diaktifkan'));
      expect(msg('WRONG_PROJECT_KIND'), contains('jenis project'));
      expect(msg('HM_DECREASED'), contains('HM terakhir'));
      expect(msg('NOT_IN_CONTRACT'), contains('kontrak aktif'));
      expect(msg('DUPLICATE_DATE'), contains('sudah ada'));
      expect(msg('PO_CLOSED'), contains('PO'));
      expect(msg('CLIENT_UUID_CONFLICT'), contains('bentrok'));
      expect(msg('NOT_EDITABLE'), contains('24 jam'));
      expect(msg('STATE_CONFLICT'), 'server text');
      expect(SyncItemType.isField('aftersales_activity.upsert'), isTrue);
      expect(SyncItemType.label('service_report.upsert'), 'Laporan servis unit');
      expect(mediaUploadPath('field'), 'progress-photos');
    });

    test('numbers: Indonesian input and display', () {
      expect(parseDec('1.023,5'), 1023.5);
      expect(parseDec('1023.5'), 1023.5);
      expect(parseDec('1.023'), 1023);
      expect(parseDec(''), isNull);
      expect(fmtNum(1023.5), '1.023,5');
      expect(fmtNum(8), '8');
      expect(decInput(1031.5), '1031,5');
    });
  });

  group('/me capabilities (FR1)', () {
    Map<String, dynamic> me({required bool flag, List<String> roles = const ['pk-staff'], bool caps = true}) => {
      'id': 5,
      'email': 'mekanik@example.test',
      'roles': roles,
      'capabilities': {'approvalInbox': false},
      'companies': [
        {
          'id': 3,
          'code': 'DRMS',
          'name': 'PT Contoh DRMS',
          'roles': roles,
          'capabilities': {'serviceReportCreate': caps, 'unitTimesheetCreate': caps, 'aftersalesActivityCreate': false},
          'settings': {'fieldReportsEnabled': flag},
        },
      ],
    };

    test('tile: capability + PT flag; never for an Operator-only account', () {
      final on = userProfileFromJson(me(flag: true)).scopedTo(null);
      expect(on.hasFieldReports, isTrue);
      expect(on.capabilities.serviceReportCreate, isTrue);
      expect(canCreateField(on, FieldReportType.unitTimesheet, 3), isTrue);
      expect(canCreateField(on, FieldReportType.aftersalesActivity, 3), isFalse);
      expect(canCreateField(on, FieldReportType.serviceReport, 99), isFalse, reason: 'unknown PT');
      expect(userProfileFromJson(me(flag: false)).scopedTo(null).hasFieldReports, isFalse);
      expect(userProfileFromJson(me(flag: true, caps: false)).scopedTo(null).hasFieldReports, isFalse);
      final op = userProfileFromJson(me(flag: true, roles: ['pk-operator'])).scopedTo(null);
      expect(op.isOperatorOnly, isTrue);
      expect(op.hasFieldReports, isFalse);
      expect(Capabilities.fromRoles({Role.staff}).anyField, isFalse, reason: 'old /me: never guessed from roles');
    });
  });
}
