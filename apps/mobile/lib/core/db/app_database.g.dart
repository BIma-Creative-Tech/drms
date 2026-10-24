// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'app_database.dart';

// ignore_for_file: type=lint
class $LocalDraftsTable extends LocalDrafts
    with TableInfo<$LocalDraftsTable, LocalDraft> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $LocalDraftsTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _clientUuidMeta = const VerificationMeta(
    'clientUuid',
  );
  @override
  late final GeneratedColumn<String> clientUuid = GeneratedColumn<String>(
    'client_uuid',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _userSubMeta = const VerificationMeta(
    'userSub',
  );
  @override
  late final GeneratedColumn<String> userSub = GeneratedColumn<String>(
    'user_sub',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _companyIdMeta = const VerificationMeta(
    'companyId',
  );
  @override
  late final GeneratedColumn<int> companyId = GeneratedColumn<int>(
    'company_id',
    aliasedName,
    true,
    type: DriftSqlType.int,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _typeMeta = const VerificationMeta('type');
  @override
  late final GeneratedColumn<String> type = GeneratedColumn<String>(
    'type',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _titleMeta = const VerificationMeta('title');
  @override
  late final GeneratedColumn<String> title = GeneratedColumn<String>(
    'title',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
    defaultValue: const Constant(''),
  );
  static const VerificationMeta _projectIdMeta = const VerificationMeta(
    'projectId',
  );
  @override
  late final GeneratedColumn<int> projectId = GeneratedColumn<int>(
    'project_id',
    aliasedName,
    true,
    type: DriftSqlType.int,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _costCenterIdMeta = const VerificationMeta(
    'costCenterId',
  );
  @override
  late final GeneratedColumn<int> costCenterId = GeneratedColumn<int>(
    'cost_center_id',
    aliasedName,
    true,
    type: DriftSqlType.int,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _neededDateMeta = const VerificationMeta(
    'neededDate',
  );
  @override
  late final GeneratedColumn<String> neededDate = GeneratedColumn<String>(
    'needed_date',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _urgencyLevelIdMeta = const VerificationMeta(
    'urgencyLevelId',
  );
  @override
  late final GeneratedColumn<int> urgencyLevelId = GeneratedColumn<int>(
    'urgency_level_id',
    aliasedName,
    true,
    type: DriftSqlType.int,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _notesMeta = const VerificationMeta('notes');
  @override
  late final GeneratedColumn<String> notes = GeneratedColumn<String>(
    'notes',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _requesterIdsJsonMeta = const VerificationMeta(
    'requesterIdsJson',
  );
  @override
  late final GeneratedColumn<String> requesterIdsJson = GeneratedColumn<String>(
    'requester_ids_json',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
    defaultValue: const Constant('[]'),
  );
  static const VerificationMeta _bankAccountIdMeta = const VerificationMeta(
    'bankAccountId',
  );
  @override
  late final GeneratedColumn<int> bankAccountId = GeneratedColumn<int>(
    'bank_account_id',
    aliasedName,
    true,
    type: DriftSqlType.int,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _vendorJsonMeta = const VerificationMeta(
    'vendorJson',
  );
  @override
  late final GeneratedColumn<String> vendorJson = GeneratedColumn<String>(
    'vendor_json',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _serverIdMeta = const VerificationMeta(
    'serverId',
  );
  @override
  late final GeneratedColumn<int> serverId = GeneratedColumn<int>(
    'server_id',
    aliasedName,
    true,
    type: DriftSqlType.int,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _serverRevMeta = const VerificationMeta(
    'serverRev',
  );
  @override
  late final GeneratedColumn<int> serverRev = GeneratedColumn<int>(
    'server_rev',
    aliasedName,
    true,
    type: DriftSqlType.int,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _syncStateMeta = const VerificationMeta(
    'syncState',
  );
  @override
  late final GeneratedColumn<String> syncState = GeneratedColumn<String>(
    'sync_state',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
    defaultValue: const Constant('local'),
  );
  static const VerificationMeta _lastErrorMeta = const VerificationMeta(
    'lastError',
  );
  @override
  late final GeneratedColumn<String> lastError = GeneratedColumn<String>(
    'last_error',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _conflictCopyJsonMeta = const VerificationMeta(
    'conflictCopyJson',
  );
  @override
  late final GeneratedColumn<String> conflictCopyJson = GeneratedColumn<String>(
    'conflict_copy_json',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _deletedMeta = const VerificationMeta(
    'deleted',
  );
  @override
  late final GeneratedColumn<bool> deleted = GeneratedColumn<bool>(
    'deleted',
    aliasedName,
    false,
    type: DriftSqlType.bool,
    requiredDuringInsert: false,
    defaultConstraints: GeneratedColumn.constraintIsAlways(
      'CHECK ("deleted" IN (0, 1))',
    ),
    defaultValue: const Constant(false),
  );
  static const VerificationMeta _createdAtMeta = const VerificationMeta(
    'createdAt',
  );
  @override
  late final GeneratedColumn<DateTime> createdAt = GeneratedColumn<DateTime>(
    'created_at',
    aliasedName,
    false,
    type: DriftSqlType.dateTime,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _updatedAtMeta = const VerificationMeta(
    'updatedAt',
  );
  @override
  late final GeneratedColumn<DateTime> updatedAt = GeneratedColumn<DateTime>(
    'updated_at',
    aliasedName,
    false,
    type: DriftSqlType.dateTime,
    requiredDuringInsert: true,
  );
  @override
  List<GeneratedColumn> get $columns => [
    clientUuid,
    userSub,
    companyId,
    type,
    title,
    projectId,
    costCenterId,
    neededDate,
    urgencyLevelId,
    notes,
    requesterIdsJson,
    bankAccountId,
    vendorJson,
    serverId,
    serverRev,
    syncState,
    lastError,
    conflictCopyJson,
    deleted,
    createdAt,
    updatedAt,
  ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'local_drafts';
  @override
  VerificationContext validateIntegrity(
    Insertable<LocalDraft> instance, {
    bool isInserting = false,
  }) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('client_uuid')) {
      context.handle(
        _clientUuidMeta,
        clientUuid.isAcceptableOrUnknown(data['client_uuid']!, _clientUuidMeta),
      );
    } else if (isInserting) {
      context.missing(_clientUuidMeta);
    }
    if (data.containsKey('user_sub')) {
      context.handle(
        _userSubMeta,
        userSub.isAcceptableOrUnknown(data['user_sub']!, _userSubMeta),
      );
    } else if (isInserting) {
      context.missing(_userSubMeta);
    }
    if (data.containsKey('company_id')) {
      context.handle(
        _companyIdMeta,
        companyId.isAcceptableOrUnknown(data['company_id']!, _companyIdMeta),
      );
    }
    if (data.containsKey('type')) {
      context.handle(
        _typeMeta,
        type.isAcceptableOrUnknown(data['type']!, _typeMeta),
      );
    } else if (isInserting) {
      context.missing(_typeMeta);
    }
    if (data.containsKey('title')) {
      context.handle(
        _titleMeta,
        title.isAcceptableOrUnknown(data['title']!, _titleMeta),
      );
    }
    if (data.containsKey('project_id')) {
      context.handle(
        _projectIdMeta,
        projectId.isAcceptableOrUnknown(data['project_id']!, _projectIdMeta),
      );
    }
    if (data.containsKey('cost_center_id')) {
      context.handle(
        _costCenterIdMeta,
        costCenterId.isAcceptableOrUnknown(
          data['cost_center_id']!,
          _costCenterIdMeta,
        ),
      );
    }
    if (data.containsKey('needed_date')) {
      context.handle(
        _neededDateMeta,
        neededDate.isAcceptableOrUnknown(data['needed_date']!, _neededDateMeta),
      );
    }
    if (data.containsKey('urgency_level_id')) {
      context.handle(
        _urgencyLevelIdMeta,
        urgencyLevelId.isAcceptableOrUnknown(
          data['urgency_level_id']!,
          _urgencyLevelIdMeta,
        ),
      );
    }
    if (data.containsKey('notes')) {
      context.handle(
        _notesMeta,
        notes.isAcceptableOrUnknown(data['notes']!, _notesMeta),
      );
    }
    if (data.containsKey('requester_ids_json')) {
      context.handle(
        _requesterIdsJsonMeta,
        requesterIdsJson.isAcceptableOrUnknown(
          data['requester_ids_json']!,
          _requesterIdsJsonMeta,
        ),
      );
    }
    if (data.containsKey('bank_account_id')) {
      context.handle(
        _bankAccountIdMeta,
        bankAccountId.isAcceptableOrUnknown(
          data['bank_account_id']!,
          _bankAccountIdMeta,
        ),
      );
    }
    if (data.containsKey('vendor_json')) {
      context.handle(
        _vendorJsonMeta,
        vendorJson.isAcceptableOrUnknown(data['vendor_json']!, _vendorJsonMeta),
      );
    }
    if (data.containsKey('server_id')) {
      context.handle(
        _serverIdMeta,
        serverId.isAcceptableOrUnknown(data['server_id']!, _serverIdMeta),
      );
    }
    if (data.containsKey('server_rev')) {
      context.handle(
        _serverRevMeta,
        serverRev.isAcceptableOrUnknown(data['server_rev']!, _serverRevMeta),
      );
    }
    if (data.containsKey('sync_state')) {
      context.handle(
        _syncStateMeta,
        syncState.isAcceptableOrUnknown(data['sync_state']!, _syncStateMeta),
      );
    }
    if (data.containsKey('last_error')) {
      context.handle(
        _lastErrorMeta,
        lastError.isAcceptableOrUnknown(data['last_error']!, _lastErrorMeta),
      );
    }
    if (data.containsKey('conflict_copy_json')) {
      context.handle(
        _conflictCopyJsonMeta,
        conflictCopyJson.isAcceptableOrUnknown(
          data['conflict_copy_json']!,
          _conflictCopyJsonMeta,
        ),
      );
    }
    if (data.containsKey('deleted')) {
      context.handle(
        _deletedMeta,
        deleted.isAcceptableOrUnknown(data['deleted']!, _deletedMeta),
      );
    }
    if (data.containsKey('created_at')) {
      context.handle(
        _createdAtMeta,
        createdAt.isAcceptableOrUnknown(data['created_at']!, _createdAtMeta),
      );
    } else if (isInserting) {
      context.missing(_createdAtMeta);
    }
    if (data.containsKey('updated_at')) {
      context.handle(
        _updatedAtMeta,
        updatedAt.isAcceptableOrUnknown(data['updated_at']!, _updatedAtMeta),
      );
    } else if (isInserting) {
      context.missing(_updatedAtMeta);
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {clientUuid};
  @override
  LocalDraft map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return LocalDraft(
      clientUuid: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}client_uuid'],
      )!,
      userSub: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}user_sub'],
      )!,
      companyId: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}company_id'],
      ),
      type: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}type'],
      )!,
      title: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}title'],
      )!,
      projectId: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}project_id'],
      ),
      costCenterId: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}cost_center_id'],
      ),
      neededDate: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}needed_date'],
      ),
      urgencyLevelId: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}urgency_level_id'],
      ),
      notes: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}notes'],
      ),
      requesterIdsJson: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}requester_ids_json'],
      )!,
      bankAccountId: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}bank_account_id'],
      ),
      vendorJson: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}vendor_json'],
      ),
      serverId: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}server_id'],
      ),
      serverRev: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}server_rev'],
      ),
      syncState: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}sync_state'],
      )!,
      lastError: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}last_error'],
      ),
      conflictCopyJson: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}conflict_copy_json'],
      ),
      deleted: attachedDatabase.typeMapping.read(
        DriftSqlType.bool,
        data['${effectivePrefix}deleted'],
      )!,
      createdAt: attachedDatabase.typeMapping.read(
        DriftSqlType.dateTime,
        data['${effectivePrefix}created_at'],
      )!,
      updatedAt: attachedDatabase.typeMapping.read(
        DriftSqlType.dateTime,
        data['${effectivePrefix}updated_at'],
      )!,
    );
  }

  @override
  $LocalDraftsTable createAlias(String alias) {
    return $LocalDraftsTable(attachedDatabase, alias);
  }
}

class LocalDraft extends DataClass implements Insertable<LocalDraft> {
  final String clientUuid;
  final String userSub;

  /// MC3 (schema v3): PT of the draft. Null = written before v3 and not yet assigned ("needs PT" when
  /// the user has several PTs; see `CompanyBackfill`). Lines and receipts belong to the draft's PT.
  final int? companyId;
  final String type;
  final String title;
  final int? projectId;
  final int? costCenterId;
  final String? neededDate;

  /// Schema v4 (owner decision 2026-10-09): "Tingkat urgensi" of the draft; null = not chosen.
  final int? urgencyLevelId;
  final String? notes;
  final String requesterIdsJson;
  final int? bankAccountId;

  /// Schema v10 (ADR 0027 "Pembayaran vendor"): payee type + vendor / vendor account / invoice of the draft as JSON
  /// (`DraftRepository` vendorToJson); null = an employee payment (every draft before v10).
  final String? vendorJson;
  final int? serverId;
  final int? serverRev;

  /// local | queued | synced | conflict | rejected | submitted
  final String syncState;
  final String? lastError;
  final String? conflictCopyJson;
  final bool deleted;
  final DateTime createdAt;
  final DateTime updatedAt;
  const LocalDraft({
    required this.clientUuid,
    required this.userSub,
    this.companyId,
    required this.type,
    required this.title,
    this.projectId,
    this.costCenterId,
    this.neededDate,
    this.urgencyLevelId,
    this.notes,
    required this.requesterIdsJson,
    this.bankAccountId,
    this.vendorJson,
    this.serverId,
    this.serverRev,
    required this.syncState,
    this.lastError,
    this.conflictCopyJson,
    required this.deleted,
    required this.createdAt,
    required this.updatedAt,
  });
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['client_uuid'] = Variable<String>(clientUuid);
    map['user_sub'] = Variable<String>(userSub);
    if (!nullToAbsent || companyId != null) {
      map['company_id'] = Variable<int>(companyId);
    }
    map['type'] = Variable<String>(type);
    map['title'] = Variable<String>(title);
    if (!nullToAbsent || projectId != null) {
      map['project_id'] = Variable<int>(projectId);
    }
    if (!nullToAbsent || costCenterId != null) {
      map['cost_center_id'] = Variable<int>(costCenterId);
    }
    if (!nullToAbsent || neededDate != null) {
      map['needed_date'] = Variable<String>(neededDate);
    }
    if (!nullToAbsent || urgencyLevelId != null) {
      map['urgency_level_id'] = Variable<int>(urgencyLevelId);
    }
    if (!nullToAbsent || notes != null) {
      map['notes'] = Variable<String>(notes);
    }
    map['requester_ids_json'] = Variable<String>(requesterIdsJson);
    if (!nullToAbsent || bankAccountId != null) {
      map['bank_account_id'] = Variable<int>(bankAccountId);
    }
    if (!nullToAbsent || vendorJson != null) {
      map['vendor_json'] = Variable<String>(vendorJson);
    }
    if (!nullToAbsent || serverId != null) {
      map['server_id'] = Variable<int>(serverId);
    }
    if (!nullToAbsent || serverRev != null) {
      map['server_rev'] = Variable<int>(serverRev);
    }
    map['sync_state'] = Variable<String>(syncState);
    if (!nullToAbsent || lastError != null) {
      map['last_error'] = Variable<String>(lastError);
    }
    if (!nullToAbsent || conflictCopyJson != null) {
      map['conflict_copy_json'] = Variable<String>(conflictCopyJson);
    }
    map['deleted'] = Variable<bool>(deleted);
    map['created_at'] = Variable<DateTime>(createdAt);
    map['updated_at'] = Variable<DateTime>(updatedAt);
    return map;
  }

  LocalDraftsCompanion toCompanion(bool nullToAbsent) {
    return LocalDraftsCompanion(
      clientUuid: Value(clientUuid),
      userSub: Value(userSub),
      companyId: companyId == null && nullToAbsent
          ? const Value.absent()
          : Value(companyId),
      type: Value(type),
      title: Value(title),
      projectId: projectId == null && nullToAbsent
          ? const Value.absent()
          : Value(projectId),
      costCenterId: costCenterId == null && nullToAbsent
          ? const Value.absent()
          : Value(costCenterId),
      neededDate: neededDate == null && nullToAbsent
          ? const Value.absent()
          : Value(neededDate),
      urgencyLevelId: urgencyLevelId == null && nullToAbsent
          ? const Value.absent()
          : Value(urgencyLevelId),
      notes: notes == null && nullToAbsent
          ? const Value.absent()
          : Value(notes),
      requesterIdsJson: Value(requesterIdsJson),
      bankAccountId: bankAccountId == null && nullToAbsent
          ? const Value.absent()
          : Value(bankAccountId),
      vendorJson: vendorJson == null && nullToAbsent
          ? const Value.absent()
          : Value(vendorJson),
      serverId: serverId == null && nullToAbsent
          ? const Value.absent()
          : Value(serverId),
      serverRev: serverRev == null && nullToAbsent
          ? const Value.absent()
          : Value(serverRev),
      syncState: Value(syncState),
      lastError: lastError == null && nullToAbsent
          ? const Value.absent()
          : Value(lastError),
      conflictCopyJson: conflictCopyJson == null && nullToAbsent
          ? const Value.absent()
          : Value(conflictCopyJson),
      deleted: Value(deleted),
      createdAt: Value(createdAt),
      updatedAt: Value(updatedAt),
    );
  }

  factory LocalDraft.fromJson(
    Map<String, dynamic> json, {
    ValueSerializer? serializer,
  }) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return LocalDraft(
      clientUuid: serializer.fromJson<String>(json['clientUuid']),
      userSub: serializer.fromJson<String>(json['userSub']),
      companyId: serializer.fromJson<int?>(json['companyId']),
      type: serializer.fromJson<String>(json['type']),
      title: serializer.fromJson<String>(json['title']),
      projectId: serializer.fromJson<int?>(json['projectId']),
      costCenterId: serializer.fromJson<int?>(json['costCenterId']),
      neededDate: serializer.fromJson<String?>(json['neededDate']),
      urgencyLevelId: serializer.fromJson<int?>(json['urgencyLevelId']),
      notes: serializer.fromJson<String?>(json['notes']),
      requesterIdsJson: serializer.fromJson<String>(json['requesterIdsJson']),
      bankAccountId: serializer.fromJson<int?>(json['bankAccountId']),
      vendorJson: serializer.fromJson<String?>(json['vendorJson']),
      serverId: serializer.fromJson<int?>(json['serverId']),
      serverRev: serializer.fromJson<int?>(json['serverRev']),
      syncState: serializer.fromJson<String>(json['syncState']),
      lastError: serializer.fromJson<String?>(json['lastError']),
      conflictCopyJson: serializer.fromJson<String?>(json['conflictCopyJson']),
      deleted: serializer.fromJson<bool>(json['deleted']),
      createdAt: serializer.fromJson<DateTime>(json['createdAt']),
      updatedAt: serializer.fromJson<DateTime>(json['updatedAt']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'clientUuid': serializer.toJson<String>(clientUuid),
      'userSub': serializer.toJson<String>(userSub),
      'companyId': serializer.toJson<int?>(companyId),
      'type': serializer.toJson<String>(type),
      'title': serializer.toJson<String>(title),
      'projectId': serializer.toJson<int?>(projectId),
      'costCenterId': serializer.toJson<int?>(costCenterId),
      'neededDate': serializer.toJson<String?>(neededDate),
      'urgencyLevelId': serializer.toJson<int?>(urgencyLevelId),
      'notes': serializer.toJson<String?>(notes),
      'requesterIdsJson': serializer.toJson<String>(requesterIdsJson),
      'bankAccountId': serializer.toJson<int?>(bankAccountId),
      'vendorJson': serializer.toJson<String?>(vendorJson),
      'serverId': serializer.toJson<int?>(serverId),
      'serverRev': serializer.toJson<int?>(serverRev),
      'syncState': serializer.toJson<String>(syncState),
      'lastError': serializer.toJson<String?>(lastError),
      'conflictCopyJson': serializer.toJson<String?>(conflictCopyJson),
      'deleted': serializer.toJson<bool>(deleted),
      'createdAt': serializer.toJson<DateTime>(createdAt),
      'updatedAt': serializer.toJson<DateTime>(updatedAt),
    };
  }

  LocalDraft copyWith({
    String? clientUuid,
    String? userSub,
    Value<int?> companyId = const Value.absent(),
    String? type,
    String? title,
    Value<int?> projectId = const Value.absent(),
    Value<int?> costCenterId = const Value.absent(),
    Value<String?> neededDate = const Value.absent(),
    Value<int?> urgencyLevelId = const Value.absent(),
    Value<String?> notes = const Value.absent(),
    String? requesterIdsJson,
    Value<int?> bankAccountId = const Value.absent(),
    Value<String?> vendorJson = const Value.absent(),
    Value<int?> serverId = const Value.absent(),
    Value<int?> serverRev = const Value.absent(),
    String? syncState,
    Value<String?> lastError = const Value.absent(),
    Value<String?> conflictCopyJson = const Value.absent(),
    bool? deleted,
    DateTime? createdAt,
    DateTime? updatedAt,
  }) => LocalDraft(
    clientUuid: clientUuid ?? this.clientUuid,
    userSub: userSub ?? this.userSub,
    companyId: companyId.present ? companyId.value : this.companyId,
    type: type ?? this.type,
    title: title ?? this.title,
    projectId: projectId.present ? projectId.value : this.projectId,
    costCenterId: costCenterId.present ? costCenterId.value : this.costCenterId,
    neededDate: neededDate.present ? neededDate.value : this.neededDate,
    urgencyLevelId: urgencyLevelId.present
        ? urgencyLevelId.value
        : this.urgencyLevelId,
    notes: notes.present ? notes.value : this.notes,
    requesterIdsJson: requesterIdsJson ?? this.requesterIdsJson,
    bankAccountId: bankAccountId.present
        ? bankAccountId.value
        : this.bankAccountId,
    vendorJson: vendorJson.present ? vendorJson.value : this.vendorJson,
    serverId: serverId.present ? serverId.value : this.serverId,
    serverRev: serverRev.present ? serverRev.value : this.serverRev,
    syncState: syncState ?? this.syncState,
    lastError: lastError.present ? lastError.value : this.lastError,
    conflictCopyJson: conflictCopyJson.present
        ? conflictCopyJson.value
        : this.conflictCopyJson,
    deleted: deleted ?? this.deleted,
    createdAt: createdAt ?? this.createdAt,
    updatedAt: updatedAt ?? this.updatedAt,
  );
  LocalDraft copyWithCompanion(LocalDraftsCompanion data) {
    return LocalDraft(
      clientUuid: data.clientUuid.present
          ? data.clientUuid.value
          : this.clientUuid,
      userSub: data.userSub.present ? data.userSub.value : this.userSub,
      companyId: data.companyId.present ? data.companyId.value : this.companyId,
      type: data.type.present ? data.type.value : this.type,
      title: data.title.present ? data.title.value : this.title,
      projectId: data.projectId.present ? data.projectId.value : this.projectId,
      costCenterId: data.costCenterId.present
          ? data.costCenterId.value
          : this.costCenterId,
      neededDate: data.neededDate.present
          ? data.neededDate.value
          : this.neededDate,
      urgencyLevelId: data.urgencyLevelId.present
          ? data.urgencyLevelId.value
          : this.urgencyLevelId,
      notes: data.notes.present ? data.notes.value : this.notes,
      requesterIdsJson: data.requesterIdsJson.present
          ? data.requesterIdsJson.value
          : this.requesterIdsJson,
      bankAccountId: data.bankAccountId.present
          ? data.bankAccountId.value
          : this.bankAccountId,
      vendorJson: data.vendorJson.present
          ? data.vendorJson.value
          : this.vendorJson,
      serverId: data.serverId.present ? data.serverId.value : this.serverId,
      serverRev: data.serverRev.present ? data.serverRev.value : this.serverRev,
      syncState: data.syncState.present ? data.syncState.value : this.syncState,
      lastError: data.lastError.present ? data.lastError.value : this.lastError,
      conflictCopyJson: data.conflictCopyJson.present
          ? data.conflictCopyJson.value
          : this.conflictCopyJson,
      deleted: data.deleted.present ? data.deleted.value : this.deleted,
      createdAt: data.createdAt.present ? data.createdAt.value : this.createdAt,
      updatedAt: data.updatedAt.present ? data.updatedAt.value : this.updatedAt,
    );
  }

  @override
  String toString() {
    return (StringBuffer('LocalDraft(')
          ..write('clientUuid: $clientUuid, ')
          ..write('userSub: $userSub, ')
          ..write('companyId: $companyId, ')
          ..write('type: $type, ')
          ..write('title: $title, ')
          ..write('projectId: $projectId, ')
          ..write('costCenterId: $costCenterId, ')
          ..write('neededDate: $neededDate, ')
          ..write('urgencyLevelId: $urgencyLevelId, ')
          ..write('notes: $notes, ')
          ..write('requesterIdsJson: $requesterIdsJson, ')
          ..write('bankAccountId: $bankAccountId, ')
          ..write('vendorJson: $vendorJson, ')
          ..write('serverId: $serverId, ')
          ..write('serverRev: $serverRev, ')
          ..write('syncState: $syncState, ')
          ..write('lastError: $lastError, ')
          ..write('conflictCopyJson: $conflictCopyJson, ')
          ..write('deleted: $deleted, ')
          ..write('createdAt: $createdAt, ')
          ..write('updatedAt: $updatedAt')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hashAll([
    clientUuid,
    userSub,
    companyId,
    type,
    title,
    projectId,
    costCenterId,
    neededDate,
    urgencyLevelId,
    notes,
    requesterIdsJson,
    bankAccountId,
    vendorJson,
    serverId,
    serverRev,
    syncState,
    lastError,
    conflictCopyJson,
    deleted,
    createdAt,
    updatedAt,
  ]);
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is LocalDraft &&
          other.clientUuid == this.clientUuid &&
          other.userSub == this.userSub &&
          other.companyId == this.companyId &&
          other.type == this.type &&
          other.title == this.title &&
          other.projectId == this.projectId &&
          other.costCenterId == this.costCenterId &&
          other.neededDate == this.neededDate &&
          other.urgencyLevelId == this.urgencyLevelId &&
          other.notes == this.notes &&
          other.requesterIdsJson == this.requesterIdsJson &&
          other.bankAccountId == this.bankAccountId &&
          other.vendorJson == this.vendorJson &&
          other.serverId == this.serverId &&
          other.serverRev == this.serverRev &&
          other.syncState == this.syncState &&
          other.lastError == this.lastError &&
          other.conflictCopyJson == this.conflictCopyJson &&
          other.deleted == this.deleted &&
          other.createdAt == this.createdAt &&
          other.updatedAt == this.updatedAt);
}

class LocalDraftsCompanion extends UpdateCompanion<LocalDraft> {
  final Value<String> clientUuid;
  final Value<String> userSub;
  final Value<int?> companyId;
  final Value<String> type;
  final Value<String> title;
  final Value<int?> projectId;
  final Value<int?> costCenterId;
  final Value<String?> neededDate;
  final Value<int?> urgencyLevelId;
  final Value<String?> notes;
  final Value<String> requesterIdsJson;
  final Value<int?> bankAccountId;
  final Value<String?> vendorJson;
  final Value<int?> serverId;
  final Value<int?> serverRev;
  final Value<String> syncState;
  final Value<String?> lastError;
  final Value<String?> conflictCopyJson;
  final Value<bool> deleted;
  final Value<DateTime> createdAt;
  final Value<DateTime> updatedAt;
  final Value<int> rowid;
  const LocalDraftsCompanion({
    this.clientUuid = const Value.absent(),
    this.userSub = const Value.absent(),
    this.companyId = const Value.absent(),
    this.type = const Value.absent(),
    this.title = const Value.absent(),
    this.projectId = const Value.absent(),
    this.costCenterId = const Value.absent(),
    this.neededDate = const Value.absent(),
    this.urgencyLevelId = const Value.absent(),
    this.notes = const Value.absent(),
    this.requesterIdsJson = const Value.absent(),
    this.bankAccountId = const Value.absent(),
    this.vendorJson = const Value.absent(),
    this.serverId = const Value.absent(),
    this.serverRev = const Value.absent(),
    this.syncState = const Value.absent(),
    this.lastError = const Value.absent(),
    this.conflictCopyJson = const Value.absent(),
    this.deleted = const Value.absent(),
    this.createdAt = const Value.absent(),
    this.updatedAt = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  LocalDraftsCompanion.insert({
    required String clientUuid,
    required String userSub,
    this.companyId = const Value.absent(),
    required String type,
    this.title = const Value.absent(),
    this.projectId = const Value.absent(),
    this.costCenterId = const Value.absent(),
    this.neededDate = const Value.absent(),
    this.urgencyLevelId = const Value.absent(),
    this.notes = const Value.absent(),
    this.requesterIdsJson = const Value.absent(),
    this.bankAccountId = const Value.absent(),
    this.vendorJson = const Value.absent(),
    this.serverId = const Value.absent(),
    this.serverRev = const Value.absent(),
    this.syncState = const Value.absent(),
    this.lastError = const Value.absent(),
    this.conflictCopyJson = const Value.absent(),
    this.deleted = const Value.absent(),
    required DateTime createdAt,
    required DateTime updatedAt,
    this.rowid = const Value.absent(),
  }) : clientUuid = Value(clientUuid),
       userSub = Value(userSub),
       type = Value(type),
       createdAt = Value(createdAt),
       updatedAt = Value(updatedAt);
  static Insertable<LocalDraft> custom({
    Expression<String>? clientUuid,
    Expression<String>? userSub,
    Expression<int>? companyId,
    Expression<String>? type,
    Expression<String>? title,
    Expression<int>? projectId,
    Expression<int>? costCenterId,
    Expression<String>? neededDate,
    Expression<int>? urgencyLevelId,
    Expression<String>? notes,
    Expression<String>? requesterIdsJson,
    Expression<int>? bankAccountId,
    Expression<String>? vendorJson,
    Expression<int>? serverId,
    Expression<int>? serverRev,
    Expression<String>? syncState,
    Expression<String>? lastError,
    Expression<String>? conflictCopyJson,
    Expression<bool>? deleted,
    Expression<DateTime>? createdAt,
    Expression<DateTime>? updatedAt,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (clientUuid != null) 'client_uuid': clientUuid,
      if (userSub != null) 'user_sub': userSub,
      if (companyId != null) 'company_id': companyId,
      if (type != null) 'type': type,
      if (title != null) 'title': title,
      if (projectId != null) 'project_id': projectId,
      if (costCenterId != null) 'cost_center_id': costCenterId,
      if (neededDate != null) 'needed_date': neededDate,
      if (urgencyLevelId != null) 'urgency_level_id': urgencyLevelId,
      if (notes != null) 'notes': notes,
      if (requesterIdsJson != null) 'requester_ids_json': requesterIdsJson,
      if (bankAccountId != null) 'bank_account_id': bankAccountId,
      if (vendorJson != null) 'vendor_json': vendorJson,
      if (serverId != null) 'server_id': serverId,
      if (serverRev != null) 'server_rev': serverRev,
      if (syncState != null) 'sync_state': syncState,
      if (lastError != null) 'last_error': lastError,
      if (conflictCopyJson != null) 'conflict_copy_json': conflictCopyJson,
      if (deleted != null) 'deleted': deleted,
      if (createdAt != null) 'created_at': createdAt,
      if (updatedAt != null) 'updated_at': updatedAt,
      if (rowid != null) 'rowid': rowid,
    });
  }

  LocalDraftsCompanion copyWith({
    Value<String>? clientUuid,
    Value<String>? userSub,
    Value<int?>? companyId,
    Value<String>? type,
    Value<String>? title,
    Value<int?>? projectId,
    Value<int?>? costCenterId,
    Value<String?>? neededDate,
    Value<int?>? urgencyLevelId,
    Value<String?>? notes,
    Value<String>? requesterIdsJson,
    Value<int?>? bankAccountId,
    Value<String?>? vendorJson,
    Value<int?>? serverId,
    Value<int?>? serverRev,
    Value<String>? syncState,
    Value<String?>? lastError,
    Value<String?>? conflictCopyJson,
    Value<bool>? deleted,
    Value<DateTime>? createdAt,
    Value<DateTime>? updatedAt,
    Value<int>? rowid,
  }) {
    return LocalDraftsCompanion(
      clientUuid: clientUuid ?? this.clientUuid,
      userSub: userSub ?? this.userSub,
      companyId: companyId ?? this.companyId,
      type: type ?? this.type,
      title: title ?? this.title,
      projectId: projectId ?? this.projectId,
      costCenterId: costCenterId ?? this.costCenterId,
      neededDate: neededDate ?? this.neededDate,
      urgencyLevelId: urgencyLevelId ?? this.urgencyLevelId,
      notes: notes ?? this.notes,
      requesterIdsJson: requesterIdsJson ?? this.requesterIdsJson,
      bankAccountId: bankAccountId ?? this.bankAccountId,
      vendorJson: vendorJson ?? this.vendorJson,
      serverId: serverId ?? this.serverId,
      serverRev: serverRev ?? this.serverRev,
      syncState: syncState ?? this.syncState,
      lastError: lastError ?? this.lastError,
      conflictCopyJson: conflictCopyJson ?? this.conflictCopyJson,
      deleted: deleted ?? this.deleted,
      createdAt: createdAt ?? this.createdAt,
      updatedAt: updatedAt ?? this.updatedAt,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (clientUuid.present) {
      map['client_uuid'] = Variable<String>(clientUuid.value);
    }
    if (userSub.present) {
      map['user_sub'] = Variable<String>(userSub.value);
    }
    if (companyId.present) {
      map['company_id'] = Variable<int>(companyId.value);
    }
    if (type.present) {
      map['type'] = Variable<String>(type.value);
    }
    if (title.present) {
      map['title'] = Variable<String>(title.value);
    }
    if (projectId.present) {
      map['project_id'] = Variable<int>(projectId.value);
    }
    if (costCenterId.present) {
      map['cost_center_id'] = Variable<int>(costCenterId.value);
    }
    if (neededDate.present) {
      map['needed_date'] = Variable<String>(neededDate.value);
    }
    if (urgencyLevelId.present) {
      map['urgency_level_id'] = Variable<int>(urgencyLevelId.value);
    }
    if (notes.present) {
      map['notes'] = Variable<String>(notes.value);
    }
    if (requesterIdsJson.present) {
      map['requester_ids_json'] = Variable<String>(requesterIdsJson.value);
    }
    if (bankAccountId.present) {
      map['bank_account_id'] = Variable<int>(bankAccountId.value);
    }
    if (vendorJson.present) {
      map['vendor_json'] = Variable<String>(vendorJson.value);
    }
    if (serverId.present) {
      map['server_id'] = Variable<int>(serverId.value);
    }
    if (serverRev.present) {
      map['server_rev'] = Variable<int>(serverRev.value);
    }
    if (syncState.present) {
      map['sync_state'] = Variable<String>(syncState.value);
    }
    if (lastError.present) {
      map['last_error'] = Variable<String>(lastError.value);
    }
    if (conflictCopyJson.present) {
      map['conflict_copy_json'] = Variable<String>(conflictCopyJson.value);
    }
    if (deleted.present) {
      map['deleted'] = Variable<bool>(deleted.value);
    }
    if (createdAt.present) {
      map['created_at'] = Variable<DateTime>(createdAt.value);
    }
    if (updatedAt.present) {
      map['updated_at'] = Variable<DateTime>(updatedAt.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('LocalDraftsCompanion(')
          ..write('clientUuid: $clientUuid, ')
          ..write('userSub: $userSub, ')
          ..write('companyId: $companyId, ')
          ..write('type: $type, ')
          ..write('title: $title, ')
          ..write('projectId: $projectId, ')
          ..write('costCenterId: $costCenterId, ')
          ..write('neededDate: $neededDate, ')
          ..write('urgencyLevelId: $urgencyLevelId, ')
          ..write('notes: $notes, ')
          ..write('requesterIdsJson: $requesterIdsJson, ')
          ..write('bankAccountId: $bankAccountId, ')
          ..write('vendorJson: $vendorJson, ')
          ..write('serverId: $serverId, ')
          ..write('serverRev: $serverRev, ')
          ..write('syncState: $syncState, ')
          ..write('lastError: $lastError, ')
          ..write('conflictCopyJson: $conflictCopyJson, ')
          ..write('deleted: $deleted, ')
          ..write('createdAt: $createdAt, ')
          ..write('updatedAt: $updatedAt, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

class $LocalLinesTable extends LocalLines
    with TableInfo<$LocalLinesTable, LocalLine> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $LocalLinesTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _clientUuidMeta = const VerificationMeta(
    'clientUuid',
  );
  @override
  late final GeneratedColumn<String> clientUuid = GeneratedColumn<String>(
    'client_uuid',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _draftUuidMeta = const VerificationMeta(
    'draftUuid',
  );
  @override
  late final GeneratedColumn<String> draftUuid = GeneratedColumn<String>(
    'draft_uuid',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
    defaultConstraints: GeneratedColumn.constraintIsAlways(
      'REFERENCES local_drafts (client_uuid)',
    ),
  );
  static const VerificationMeta _noMeta = const VerificationMeta('no');
  @override
  late final GeneratedColumn<int> no = GeneratedColumn<int>(
    'no',
    aliasedName,
    false,
    type: DriftSqlType.int,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _descriptionMeta = const VerificationMeta(
    'description',
  );
  @override
  late final GeneratedColumn<String> description = GeneratedColumn<String>(
    'description',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
    defaultValue: const Constant(''),
  );
  static const VerificationMeta _qtyMeta = const VerificationMeta('qty');
  @override
  late final GeneratedColumn<double> qty = GeneratedColumn<double>(
    'qty',
    aliasedName,
    true,
    type: DriftSqlType.double,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _uomIdMeta = const VerificationMeta('uomId');
  @override
  late final GeneratedColumn<int> uomId = GeneratedColumn<int>(
    'uom_id',
    aliasedName,
    true,
    type: DriftSqlType.int,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _unitPriceMeta = const VerificationMeta(
    'unitPrice',
  );
  @override
  late final GeneratedColumn<int> unitPrice = GeneratedColumn<int>(
    'unit_price',
    aliasedName,
    true,
    type: DriftSqlType.int,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _totalMeta = const VerificationMeta('total');
  @override
  late final GeneratedColumn<int> total = GeneratedColumn<int>(
    'total',
    aliasedName,
    true,
    type: DriftSqlType.int,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _receiptAmountMeta = const VerificationMeta(
    'receiptAmount',
  );
  @override
  late final GeneratedColumn<int> receiptAmount = GeneratedColumn<int>(
    'receipt_amount',
    aliasedName,
    true,
    type: DriftSqlType.int,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _rapItemIdMeta = const VerificationMeta(
    'rapItemId',
  );
  @override
  late final GeneratedColumn<int> rapItemId = GeneratedColumn<int>(
    'rap_item_id',
    aliasedName,
    true,
    type: DriftSqlType.int,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _categoryIdMeta = const VerificationMeta(
    'categoryId',
  );
  @override
  late final GeneratedColumn<int> categoryId = GeneratedColumn<int>(
    'category_id',
    aliasedName,
    true,
    type: DriftSqlType.int,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _vehicleIdMeta = const VerificationMeta(
    'vehicleId',
  );
  @override
  late final GeneratedColumn<int> vehicleId = GeneratedColumn<int>(
    'vehicle_id',
    aliasedName,
    true,
    type: DriftSqlType.int,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _notesMeta = const VerificationMeta('notes');
  @override
  late final GeneratedColumn<String> notes = GeneratedColumn<String>(
    'notes',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  @override
  List<GeneratedColumn> get $columns => [
    clientUuid,
    draftUuid,
    no,
    description,
    qty,
    uomId,
    unitPrice,
    total,
    receiptAmount,
    rapItemId,
    categoryId,
    vehicleId,
    notes,
  ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'local_lines';
  @override
  VerificationContext validateIntegrity(
    Insertable<LocalLine> instance, {
    bool isInserting = false,
  }) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('client_uuid')) {
      context.handle(
        _clientUuidMeta,
        clientUuid.isAcceptableOrUnknown(data['client_uuid']!, _clientUuidMeta),
      );
    } else if (isInserting) {
      context.missing(_clientUuidMeta);
    }
    if (data.containsKey('draft_uuid')) {
      context.handle(
        _draftUuidMeta,
        draftUuid.isAcceptableOrUnknown(data['draft_uuid']!, _draftUuidMeta),
      );
    } else if (isInserting) {
      context.missing(_draftUuidMeta);
    }
    if (data.containsKey('no')) {
      context.handle(_noMeta, no.isAcceptableOrUnknown(data['no']!, _noMeta));
    } else if (isInserting) {
      context.missing(_noMeta);
    }
    if (data.containsKey('description')) {
      context.handle(
        _descriptionMeta,
        description.isAcceptableOrUnknown(
          data['description']!,
          _descriptionMeta,
        ),
      );
    }
    if (data.containsKey('qty')) {
      context.handle(
        _qtyMeta,
        qty.isAcceptableOrUnknown(data['qty']!, _qtyMeta),
      );
    }
    if (data.containsKey('uom_id')) {
      context.handle(
        _uomIdMeta,
        uomId.isAcceptableOrUnknown(data['uom_id']!, _uomIdMeta),
      );
    }
    if (data.containsKey('unit_price')) {
      context.handle(
        _unitPriceMeta,
        unitPrice.isAcceptableOrUnknown(data['unit_price']!, _unitPriceMeta),
      );
    }
    if (data.containsKey('total')) {
      context.handle(
        _totalMeta,
        total.isAcceptableOrUnknown(data['total']!, _totalMeta),
      );
    }
    if (data.containsKey('receipt_amount')) {
      context.handle(
        _receiptAmountMeta,
        receiptAmount.isAcceptableOrUnknown(
          data['receipt_amount']!,
          _receiptAmountMeta,
        ),
      );
    }
    if (data.containsKey('rap_item_id')) {
      context.handle(
        _rapItemIdMeta,
        rapItemId.isAcceptableOrUnknown(data['rap_item_id']!, _rapItemIdMeta),
      );
    }
    if (data.containsKey('category_id')) {
      context.handle(
        _categoryIdMeta,
        categoryId.isAcceptableOrUnknown(data['category_id']!, _categoryIdMeta),
      );
    }
    if (data.containsKey('vehicle_id')) {
      context.handle(
        _vehicleIdMeta,
        vehicleId.isAcceptableOrUnknown(data['vehicle_id']!, _vehicleIdMeta),
      );
    }
    if (data.containsKey('notes')) {
      context.handle(
        _notesMeta,
        notes.isAcceptableOrUnknown(data['notes']!, _notesMeta),
      );
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {clientUuid};
  @override
  LocalLine map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return LocalLine(
      clientUuid: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}client_uuid'],
      )!,
      draftUuid: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}draft_uuid'],
      )!,
      no: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}no'],
      )!,
      description: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}description'],
      )!,
      qty: attachedDatabase.typeMapping.read(
        DriftSqlType.double,
        data['${effectivePrefix}qty'],
      ),
      uomId: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}uom_id'],
      ),
      unitPrice: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}unit_price'],
      ),
      total: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}total'],
      ),
      receiptAmount: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}receipt_amount'],
      ),
      rapItemId: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}rap_item_id'],
      ),
      categoryId: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}category_id'],
      ),
      vehicleId: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}vehicle_id'],
      ),
      notes: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}notes'],
      ),
    );
  }

  @override
  $LocalLinesTable createAlias(String alias) {
    return $LocalLinesTable(attachedDatabase, alias);
  }
}

class LocalLine extends DataClass implements Insertable<LocalLine> {
  final String clientUuid;
  final String draftUuid;
  final int no;
  final String description;
  final double? qty;
  final int? uomId;
  final int? unitPrice;
  final int? total;

  /// Schema v7 (DRMS 10/10 D3): "Nominal sesuai nota", nullable. `total` is qty × unit price from v7 on.
  final int? receiptAmount;

  /// Schema v8 (DRMS 10/10 D4): RAP item of the line, nullable. Lines written before v8 keep NULL and must pick
  /// one before the draft can be submitted.
  final int? rapItemId;
  final int? categoryId;
  final int? vehicleId;
  final String? notes;
  const LocalLine({
    required this.clientUuid,
    required this.draftUuid,
    required this.no,
    required this.description,
    this.qty,
    this.uomId,
    this.unitPrice,
    this.total,
    this.receiptAmount,
    this.rapItemId,
    this.categoryId,
    this.vehicleId,
    this.notes,
  });
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['client_uuid'] = Variable<String>(clientUuid);
    map['draft_uuid'] = Variable<String>(draftUuid);
    map['no'] = Variable<int>(no);
    map['description'] = Variable<String>(description);
    if (!nullToAbsent || qty != null) {
      map['qty'] = Variable<double>(qty);
    }
    if (!nullToAbsent || uomId != null) {
      map['uom_id'] = Variable<int>(uomId);
    }
    if (!nullToAbsent || unitPrice != null) {
      map['unit_price'] = Variable<int>(unitPrice);
    }
    if (!nullToAbsent || total != null) {
      map['total'] = Variable<int>(total);
    }
    if (!nullToAbsent || receiptAmount != null) {
      map['receipt_amount'] = Variable<int>(receiptAmount);
    }
    if (!nullToAbsent || rapItemId != null) {
      map['rap_item_id'] = Variable<int>(rapItemId);
    }
    if (!nullToAbsent || categoryId != null) {
      map['category_id'] = Variable<int>(categoryId);
    }
    if (!nullToAbsent || vehicleId != null) {
      map['vehicle_id'] = Variable<int>(vehicleId);
    }
    if (!nullToAbsent || notes != null) {
      map['notes'] = Variable<String>(notes);
    }
    return map;
  }

  LocalLinesCompanion toCompanion(bool nullToAbsent) {
    return LocalLinesCompanion(
      clientUuid: Value(clientUuid),
      draftUuid: Value(draftUuid),
      no: Value(no),
      description: Value(description),
      qty: qty == null && nullToAbsent ? const Value.absent() : Value(qty),
      uomId: uomId == null && nullToAbsent
          ? const Value.absent()
          : Value(uomId),
      unitPrice: unitPrice == null && nullToAbsent
          ? const Value.absent()
          : Value(unitPrice),
      total: total == null && nullToAbsent
          ? const Value.absent()
          : Value(total),
      receiptAmount: receiptAmount == null && nullToAbsent
          ? const Value.absent()
          : Value(receiptAmount),
      rapItemId: rapItemId == null && nullToAbsent
          ? const Value.absent()
          : Value(rapItemId),
      categoryId: categoryId == null && nullToAbsent
          ? const Value.absent()
          : Value(categoryId),
      vehicleId: vehicleId == null && nullToAbsent
          ? const Value.absent()
          : Value(vehicleId),
      notes: notes == null && nullToAbsent
          ? const Value.absent()
          : Value(notes),
    );
  }

  factory LocalLine.fromJson(
    Map<String, dynamic> json, {
    ValueSerializer? serializer,
  }) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return LocalLine(
      clientUuid: serializer.fromJson<String>(json['clientUuid']),
      draftUuid: serializer.fromJson<String>(json['draftUuid']),
      no: serializer.fromJson<int>(json['no']),
      description: serializer.fromJson<String>(json['description']),
      qty: serializer.fromJson<double?>(json['qty']),
      uomId: serializer.fromJson<int?>(json['uomId']),
      unitPrice: serializer.fromJson<int?>(json['unitPrice']),
      total: serializer.fromJson<int?>(json['total']),
      receiptAmount: serializer.fromJson<int?>(json['receiptAmount']),
      rapItemId: serializer.fromJson<int?>(json['rapItemId']),
      categoryId: serializer.fromJson<int?>(json['categoryId']),
      vehicleId: serializer.fromJson<int?>(json['vehicleId']),
      notes: serializer.fromJson<String?>(json['notes']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'clientUuid': serializer.toJson<String>(clientUuid),
      'draftUuid': serializer.toJson<String>(draftUuid),
      'no': serializer.toJson<int>(no),
      'description': serializer.toJson<String>(description),
      'qty': serializer.toJson<double?>(qty),
      'uomId': serializer.toJson<int?>(uomId),
      'unitPrice': serializer.toJson<int?>(unitPrice),
      'total': serializer.toJson<int?>(total),
      'receiptAmount': serializer.toJson<int?>(receiptAmount),
      'rapItemId': serializer.toJson<int?>(rapItemId),
      'categoryId': serializer.toJson<int?>(categoryId),
      'vehicleId': serializer.toJson<int?>(vehicleId),
      'notes': serializer.toJson<String?>(notes),
    };
  }

  LocalLine copyWith({
    String? clientUuid,
    String? draftUuid,
    int? no,
    String? description,
    Value<double?> qty = const Value.absent(),
    Value<int?> uomId = const Value.absent(),
    Value<int?> unitPrice = const Value.absent(),
    Value<int?> total = const Value.absent(),
    Value<int?> receiptAmount = const Value.absent(),
    Value<int?> rapItemId = const Value.absent(),
    Value<int?> categoryId = const Value.absent(),
    Value<int?> vehicleId = const Value.absent(),
    Value<String?> notes = const Value.absent(),
  }) => LocalLine(
    clientUuid: clientUuid ?? this.clientUuid,
    draftUuid: draftUuid ?? this.draftUuid,
    no: no ?? this.no,
    description: description ?? this.description,
    qty: qty.present ? qty.value : this.qty,
    uomId: uomId.present ? uomId.value : this.uomId,
    unitPrice: unitPrice.present ? unitPrice.value : this.unitPrice,
    total: total.present ? total.value : this.total,
    receiptAmount: receiptAmount.present
        ? receiptAmount.value
        : this.receiptAmount,
    rapItemId: rapItemId.present ? rapItemId.value : this.rapItemId,
    categoryId: categoryId.present ? categoryId.value : this.categoryId,
    vehicleId: vehicleId.present ? vehicleId.value : this.vehicleId,
    notes: notes.present ? notes.value : this.notes,
  );
  LocalLine copyWithCompanion(LocalLinesCompanion data) {
    return LocalLine(
      clientUuid: data.clientUuid.present
          ? data.clientUuid.value
          : this.clientUuid,
      draftUuid: data.draftUuid.present ? data.draftUuid.value : this.draftUuid,
      no: data.no.present ? data.no.value : this.no,
      description: data.description.present
          ? data.description.value
          : this.description,
      qty: data.qty.present ? data.qty.value : this.qty,
      uomId: data.uomId.present ? data.uomId.value : this.uomId,
      unitPrice: data.unitPrice.present ? data.unitPrice.value : this.unitPrice,
      total: data.total.present ? data.total.value : this.total,
      receiptAmount: data.receiptAmount.present
          ? data.receiptAmount.value
          : this.receiptAmount,
      rapItemId: data.rapItemId.present ? data.rapItemId.value : this.rapItemId,
      categoryId: data.categoryId.present
          ? data.categoryId.value
          : this.categoryId,
      vehicleId: data.vehicleId.present ? data.vehicleId.value : this.vehicleId,
      notes: data.notes.present ? data.notes.value : this.notes,
    );
  }

  @override
  String toString() {
    return (StringBuffer('LocalLine(')
          ..write('clientUuid: $clientUuid, ')
          ..write('draftUuid: $draftUuid, ')
          ..write('no: $no, ')
          ..write('description: $description, ')
          ..write('qty: $qty, ')
          ..write('uomId: $uomId, ')
          ..write('unitPrice: $unitPrice, ')
          ..write('total: $total, ')
          ..write('receiptAmount: $receiptAmount, ')
          ..write('rapItemId: $rapItemId, ')
          ..write('categoryId: $categoryId, ')
          ..write('vehicleId: $vehicleId, ')
          ..write('notes: $notes')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(
    clientUuid,
    draftUuid,
    no,
    description,
    qty,
    uomId,
    unitPrice,
    total,
    receiptAmount,
    rapItemId,
    categoryId,
    vehicleId,
    notes,
  );
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is LocalLine &&
          other.clientUuid == this.clientUuid &&
          other.draftUuid == this.draftUuid &&
          other.no == this.no &&
          other.description == this.description &&
          other.qty == this.qty &&
          other.uomId == this.uomId &&
          other.unitPrice == this.unitPrice &&
          other.total == this.total &&
          other.receiptAmount == this.receiptAmount &&
          other.rapItemId == this.rapItemId &&
          other.categoryId == this.categoryId &&
          other.vehicleId == this.vehicleId &&
          other.notes == this.notes);
}

class LocalLinesCompanion extends UpdateCompanion<LocalLine> {
  final Value<String> clientUuid;
  final Value<String> draftUuid;
  final Value<int> no;
  final Value<String> description;
  final Value<double?> qty;
  final Value<int?> uomId;
  final Value<int?> unitPrice;
  final Value<int?> total;
  final Value<int?> receiptAmount;
  final Value<int?> rapItemId;
  final Value<int?> categoryId;
  final Value<int?> vehicleId;
  final Value<String?> notes;
  final Value<int> rowid;
  const LocalLinesCompanion({
    this.clientUuid = const Value.absent(),
    this.draftUuid = const Value.absent(),
    this.no = const Value.absent(),
    this.description = const Value.absent(),
    this.qty = const Value.absent(),
    this.uomId = const Value.absent(),
    this.unitPrice = const Value.absent(),
    this.total = const Value.absent(),
    this.receiptAmount = const Value.absent(),
    this.rapItemId = const Value.absent(),
    this.categoryId = const Value.absent(),
    this.vehicleId = const Value.absent(),
    this.notes = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  LocalLinesCompanion.insert({
    required String clientUuid,
    required String draftUuid,
    required int no,
    this.description = const Value.absent(),
    this.qty = const Value.absent(),
    this.uomId = const Value.absent(),
    this.unitPrice = const Value.absent(),
    this.total = const Value.absent(),
    this.receiptAmount = const Value.absent(),
    this.rapItemId = const Value.absent(),
    this.categoryId = const Value.absent(),
    this.vehicleId = const Value.absent(),
    this.notes = const Value.absent(),
    this.rowid = const Value.absent(),
  }) : clientUuid = Value(clientUuid),
       draftUuid = Value(draftUuid),
       no = Value(no);
  static Insertable<LocalLine> custom({
    Expression<String>? clientUuid,
    Expression<String>? draftUuid,
    Expression<int>? no,
    Expression<String>? description,
    Expression<double>? qty,
    Expression<int>? uomId,
    Expression<int>? unitPrice,
    Expression<int>? total,
    Expression<int>? receiptAmount,
    Expression<int>? rapItemId,
    Expression<int>? categoryId,
    Expression<int>? vehicleId,
    Expression<String>? notes,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (clientUuid != null) 'client_uuid': clientUuid,
      if (draftUuid != null) 'draft_uuid': draftUuid,
      if (no != null) 'no': no,
      if (description != null) 'description': description,
      if (qty != null) 'qty': qty,
      if (uomId != null) 'uom_id': uomId,
      if (unitPrice != null) 'unit_price': unitPrice,
      if (total != null) 'total': total,
      if (receiptAmount != null) 'receipt_amount': receiptAmount,
      if (rapItemId != null) 'rap_item_id': rapItemId,
      if (categoryId != null) 'category_id': categoryId,
      if (vehicleId != null) 'vehicle_id': vehicleId,
      if (notes != null) 'notes': notes,
      if (rowid != null) 'rowid': rowid,
    });
  }

  LocalLinesCompanion copyWith({
    Value<String>? clientUuid,
    Value<String>? draftUuid,
    Value<int>? no,
    Value<String>? description,
    Value<double?>? qty,
    Value<int?>? uomId,
    Value<int?>? unitPrice,
    Value<int?>? total,
    Value<int?>? receiptAmount,
    Value<int?>? rapItemId,
    Value<int?>? categoryId,
    Value<int?>? vehicleId,
    Value<String?>? notes,
    Value<int>? rowid,
  }) {
    return LocalLinesCompanion(
      clientUuid: clientUuid ?? this.clientUuid,
      draftUuid: draftUuid ?? this.draftUuid,
      no: no ?? this.no,
      description: description ?? this.description,
      qty: qty ?? this.qty,
      uomId: uomId ?? this.uomId,
      unitPrice: unitPrice ?? this.unitPrice,
      total: total ?? this.total,
      receiptAmount: receiptAmount ?? this.receiptAmount,
      rapItemId: rapItemId ?? this.rapItemId,
      categoryId: categoryId ?? this.categoryId,
      vehicleId: vehicleId ?? this.vehicleId,
      notes: notes ?? this.notes,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (clientUuid.present) {
      map['client_uuid'] = Variable<String>(clientUuid.value);
    }
    if (draftUuid.present) {
      map['draft_uuid'] = Variable<String>(draftUuid.value);
    }
    if (no.present) {
      map['no'] = Variable<int>(no.value);
    }
    if (description.present) {
      map['description'] = Variable<String>(description.value);
    }
    if (qty.present) {
      map['qty'] = Variable<double>(qty.value);
    }
    if (uomId.present) {
      map['uom_id'] = Variable<int>(uomId.value);
    }
    if (unitPrice.present) {
      map['unit_price'] = Variable<int>(unitPrice.value);
    }
    if (total.present) {
      map['total'] = Variable<int>(total.value);
    }
    if (receiptAmount.present) {
      map['receipt_amount'] = Variable<int>(receiptAmount.value);
    }
    if (rapItemId.present) {
      map['rap_item_id'] = Variable<int>(rapItemId.value);
    }
    if (categoryId.present) {
      map['category_id'] = Variable<int>(categoryId.value);
    }
    if (vehicleId.present) {
      map['vehicle_id'] = Variable<int>(vehicleId.value);
    }
    if (notes.present) {
      map['notes'] = Variable<String>(notes.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('LocalLinesCompanion(')
          ..write('clientUuid: $clientUuid, ')
          ..write('draftUuid: $draftUuid, ')
          ..write('no: $no, ')
          ..write('description: $description, ')
          ..write('qty: $qty, ')
          ..write('uomId: $uomId, ')
          ..write('unitPrice: $unitPrice, ')
          ..write('total: $total, ')
          ..write('receiptAmount: $receiptAmount, ')
          ..write('rapItemId: $rapItemId, ')
          ..write('categoryId: $categoryId, ')
          ..write('vehicleId: $vehicleId, ')
          ..write('notes: $notes, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

class $LocalReceiptsTable extends LocalReceipts
    with TableInfo<$LocalReceiptsTable, LocalReceipt> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $LocalReceiptsTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _clientUuidMeta = const VerificationMeta(
    'clientUuid',
  );
  @override
  late final GeneratedColumn<String> clientUuid = GeneratedColumn<String>(
    'client_uuid',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _lineUuidMeta = const VerificationMeta(
    'lineUuid',
  );
  @override
  late final GeneratedColumn<String> lineUuid = GeneratedColumn<String>(
    'line_uuid',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
    defaultConstraints: GeneratedColumn.constraintIsAlways(
      'REFERENCES local_lines (client_uuid)',
    ),
  );
  static const VerificationMeta _draftUuidMeta = const VerificationMeta(
    'draftUuid',
  );
  @override
  late final GeneratedColumn<String> draftUuid = GeneratedColumn<String>(
    'draft_uuid',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
    defaultConstraints: GeneratedColumn.constraintIsAlways(
      'REFERENCES local_drafts (client_uuid)',
    ),
  );
  static const VerificationMeta _receiptNoMeta = const VerificationMeta(
    'receiptNo',
  );
  @override
  late final GeneratedColumn<String> receiptNo = GeneratedColumn<String>(
    'receipt_no',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _vendorNameMeta = const VerificationMeta(
    'vendorName',
  );
  @override
  late final GeneratedColumn<String> vendorName = GeneratedColumn<String>(
    'vendor_name',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
    defaultValue: const Constant(''),
  );
  static const VerificationMeta _receiptDateMeta = const VerificationMeta(
    'receiptDate',
  );
  @override
  late final GeneratedColumn<String> receiptDate = GeneratedColumn<String>(
    'receipt_date',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _receiptTimeMeta = const VerificationMeta(
    'receiptTime',
  );
  @override
  late final GeneratedColumn<String> receiptTime = GeneratedColumn<String>(
    'receipt_time',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _amountMeta = const VerificationMeta('amount');
  @override
  late final GeneratedColumn<int> amount = GeneratedColumn<int>(
    'amount',
    aliasedName,
    false,
    type: DriftSqlType.int,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _mediaUuidMeta = const VerificationMeta(
    'mediaUuid',
  );
  @override
  late final GeneratedColumn<String> mediaUuid = GeneratedColumn<String>(
    'media_uuid',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _serverReceiptIdMeta = const VerificationMeta(
    'serverReceiptId',
  );
  @override
  late final GeneratedColumn<int> serverReceiptId = GeneratedColumn<int>(
    'server_receipt_id',
    aliasedName,
    true,
    type: DriftSqlType.int,
    requiredDuringInsert: false,
  );
  @override
  List<GeneratedColumn> get $columns => [
    clientUuid,
    lineUuid,
    draftUuid,
    receiptNo,
    vendorName,
    receiptDate,
    receiptTime,
    amount,
    mediaUuid,
    serverReceiptId,
  ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'local_receipts';
  @override
  VerificationContext validateIntegrity(
    Insertable<LocalReceipt> instance, {
    bool isInserting = false,
  }) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('client_uuid')) {
      context.handle(
        _clientUuidMeta,
        clientUuid.isAcceptableOrUnknown(data['client_uuid']!, _clientUuidMeta),
      );
    } else if (isInserting) {
      context.missing(_clientUuidMeta);
    }
    if (data.containsKey('line_uuid')) {
      context.handle(
        _lineUuidMeta,
        lineUuid.isAcceptableOrUnknown(data['line_uuid']!, _lineUuidMeta),
      );
    } else if (isInserting) {
      context.missing(_lineUuidMeta);
    }
    if (data.containsKey('draft_uuid')) {
      context.handle(
        _draftUuidMeta,
        draftUuid.isAcceptableOrUnknown(data['draft_uuid']!, _draftUuidMeta),
      );
    } else if (isInserting) {
      context.missing(_draftUuidMeta);
    }
    if (data.containsKey('receipt_no')) {
      context.handle(
        _receiptNoMeta,
        receiptNo.isAcceptableOrUnknown(data['receipt_no']!, _receiptNoMeta),
      );
    }
    if (data.containsKey('vendor_name')) {
      context.handle(
        _vendorNameMeta,
        vendorName.isAcceptableOrUnknown(data['vendor_name']!, _vendorNameMeta),
      );
    }
    if (data.containsKey('receipt_date')) {
      context.handle(
        _receiptDateMeta,
        receiptDate.isAcceptableOrUnknown(
          data['receipt_date']!,
          _receiptDateMeta,
        ),
      );
    } else if (isInserting) {
      context.missing(_receiptDateMeta);
    }
    if (data.containsKey('receipt_time')) {
      context.handle(
        _receiptTimeMeta,
        receiptTime.isAcceptableOrUnknown(
          data['receipt_time']!,
          _receiptTimeMeta,
        ),
      );
    }
    if (data.containsKey('amount')) {
      context.handle(
        _amountMeta,
        amount.isAcceptableOrUnknown(data['amount']!, _amountMeta),
      );
    } else if (isInserting) {
      context.missing(_amountMeta);
    }
    if (data.containsKey('media_uuid')) {
      context.handle(
        _mediaUuidMeta,
        mediaUuid.isAcceptableOrUnknown(data['media_uuid']!, _mediaUuidMeta),
      );
    } else if (isInserting) {
      context.missing(_mediaUuidMeta);
    }
    if (data.containsKey('server_receipt_id')) {
      context.handle(
        _serverReceiptIdMeta,
        serverReceiptId.isAcceptableOrUnknown(
          data['server_receipt_id']!,
          _serverReceiptIdMeta,
        ),
      );
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {clientUuid};
  @override
  LocalReceipt map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return LocalReceipt(
      clientUuid: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}client_uuid'],
      )!,
      lineUuid: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}line_uuid'],
      )!,
      draftUuid: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}draft_uuid'],
      )!,
      receiptNo: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}receipt_no'],
      ),
      vendorName: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}vendor_name'],
      )!,
      receiptDate: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}receipt_date'],
      )!,
      receiptTime: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}receipt_time'],
      ),
      amount: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}amount'],
      )!,
      mediaUuid: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}media_uuid'],
      )!,
      serverReceiptId: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}server_receipt_id'],
      ),
    );
  }

  @override
  $LocalReceiptsTable createAlias(String alias) {
    return $LocalReceiptsTable(attachedDatabase, alias);
  }
}

class LocalReceipt extends DataClass implements Insertable<LocalReceipt> {
  final String clientUuid;
  final String lineUuid;
  final String draftUuid;
  final String? receiptNo;
  final String vendorName;
  final String receiptDate;
  final String? receiptTime;
  final int amount;
  final String mediaUuid;
  final int? serverReceiptId;
  const LocalReceipt({
    required this.clientUuid,
    required this.lineUuid,
    required this.draftUuid,
    this.receiptNo,
    required this.vendorName,
    required this.receiptDate,
    this.receiptTime,
    required this.amount,
    required this.mediaUuid,
    this.serverReceiptId,
  });
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['client_uuid'] = Variable<String>(clientUuid);
    map['line_uuid'] = Variable<String>(lineUuid);
    map['draft_uuid'] = Variable<String>(draftUuid);
    if (!nullToAbsent || receiptNo != null) {
      map['receipt_no'] = Variable<String>(receiptNo);
    }
    map['vendor_name'] = Variable<String>(vendorName);
    map['receipt_date'] = Variable<String>(receiptDate);
    if (!nullToAbsent || receiptTime != null) {
      map['receipt_time'] = Variable<String>(receiptTime);
    }
    map['amount'] = Variable<int>(amount);
    map['media_uuid'] = Variable<String>(mediaUuid);
    if (!nullToAbsent || serverReceiptId != null) {
      map['server_receipt_id'] = Variable<int>(serverReceiptId);
    }
    return map;
  }

  LocalReceiptsCompanion toCompanion(bool nullToAbsent) {
    return LocalReceiptsCompanion(
      clientUuid: Value(clientUuid),
      lineUuid: Value(lineUuid),
      draftUuid: Value(draftUuid),
      receiptNo: receiptNo == null && nullToAbsent
          ? const Value.absent()
          : Value(receiptNo),
      vendorName: Value(vendorName),
      receiptDate: Value(receiptDate),
      receiptTime: receiptTime == null && nullToAbsent
          ? const Value.absent()
          : Value(receiptTime),
      amount: Value(amount),
      mediaUuid: Value(mediaUuid),
      serverReceiptId: serverReceiptId == null && nullToAbsent
          ? const Value.absent()
          : Value(serverReceiptId),
    );
  }

  factory LocalReceipt.fromJson(
    Map<String, dynamic> json, {
    ValueSerializer? serializer,
  }) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return LocalReceipt(
      clientUuid: serializer.fromJson<String>(json['clientUuid']),
      lineUuid: serializer.fromJson<String>(json['lineUuid']),
      draftUuid: serializer.fromJson<String>(json['draftUuid']),
      receiptNo: serializer.fromJson<String?>(json['receiptNo']),
      vendorName: serializer.fromJson<String>(json['vendorName']),
      receiptDate: serializer.fromJson<String>(json['receiptDate']),
      receiptTime: serializer.fromJson<String?>(json['receiptTime']),
      amount: serializer.fromJson<int>(json['amount']),
      mediaUuid: serializer.fromJson<String>(json['mediaUuid']),
      serverReceiptId: serializer.fromJson<int?>(json['serverReceiptId']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'clientUuid': serializer.toJson<String>(clientUuid),
      'lineUuid': serializer.toJson<String>(lineUuid),
      'draftUuid': serializer.toJson<String>(draftUuid),
      'receiptNo': serializer.toJson<String?>(receiptNo),
      'vendorName': serializer.toJson<String>(vendorName),
      'receiptDate': serializer.toJson<String>(receiptDate),
      'receiptTime': serializer.toJson<String?>(receiptTime),
      'amount': serializer.toJson<int>(amount),
      'mediaUuid': serializer.toJson<String>(mediaUuid),
      'serverReceiptId': serializer.toJson<int?>(serverReceiptId),
    };
  }

  LocalReceipt copyWith({
    String? clientUuid,
    String? lineUuid,
    String? draftUuid,
    Value<String?> receiptNo = const Value.absent(),
    String? vendorName,
    String? receiptDate,
    Value<String?> receiptTime = const Value.absent(),
    int? amount,
    String? mediaUuid,
    Value<int?> serverReceiptId = const Value.absent(),
  }) => LocalReceipt(
    clientUuid: clientUuid ?? this.clientUuid,
    lineUuid: lineUuid ?? this.lineUuid,
    draftUuid: draftUuid ?? this.draftUuid,
    receiptNo: receiptNo.present ? receiptNo.value : this.receiptNo,
    vendorName: vendorName ?? this.vendorName,
    receiptDate: receiptDate ?? this.receiptDate,
    receiptTime: receiptTime.present ? receiptTime.value : this.receiptTime,
    amount: amount ?? this.amount,
    mediaUuid: mediaUuid ?? this.mediaUuid,
    serverReceiptId: serverReceiptId.present
        ? serverReceiptId.value
        : this.serverReceiptId,
  );
  LocalReceipt copyWithCompanion(LocalReceiptsCompanion data) {
    return LocalReceipt(
      clientUuid: data.clientUuid.present
          ? data.clientUuid.value
          : this.clientUuid,
      lineUuid: data.lineUuid.present ? data.lineUuid.value : this.lineUuid,
      draftUuid: data.draftUuid.present ? data.draftUuid.value : this.draftUuid,
      receiptNo: data.receiptNo.present ? data.receiptNo.value : this.receiptNo,
      vendorName: data.vendorName.present
          ? data.vendorName.value
          : this.vendorName,
      receiptDate: data.receiptDate.present
          ? data.receiptDate.value
          : this.receiptDate,
      receiptTime: data.receiptTime.present
          ? data.receiptTime.value
          : this.receiptTime,
      amount: data.amount.present ? data.amount.value : this.amount,
      mediaUuid: data.mediaUuid.present ? data.mediaUuid.value : this.mediaUuid,
      serverReceiptId: data.serverReceiptId.present
          ? data.serverReceiptId.value
          : this.serverReceiptId,
    );
  }

  @override
  String toString() {
    return (StringBuffer('LocalReceipt(')
          ..write('clientUuid: $clientUuid, ')
          ..write('lineUuid: $lineUuid, ')
          ..write('draftUuid: $draftUuid, ')
          ..write('receiptNo: $receiptNo, ')
          ..write('vendorName: $vendorName, ')
          ..write('receiptDate: $receiptDate, ')
          ..write('receiptTime: $receiptTime, ')
          ..write('amount: $amount, ')
          ..write('mediaUuid: $mediaUuid, ')
          ..write('serverReceiptId: $serverReceiptId')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(
    clientUuid,
    lineUuid,
    draftUuid,
    receiptNo,
    vendorName,
    receiptDate,
    receiptTime,
    amount,
    mediaUuid,
    serverReceiptId,
  );
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is LocalReceipt &&
          other.clientUuid == this.clientUuid &&
          other.lineUuid == this.lineUuid &&
          other.draftUuid == this.draftUuid &&
          other.receiptNo == this.receiptNo &&
          other.vendorName == this.vendorName &&
          other.receiptDate == this.receiptDate &&
          other.receiptTime == this.receiptTime &&
          other.amount == this.amount &&
          other.mediaUuid == this.mediaUuid &&
          other.serverReceiptId == this.serverReceiptId);
}

class LocalReceiptsCompanion extends UpdateCompanion<LocalReceipt> {
  final Value<String> clientUuid;
  final Value<String> lineUuid;
  final Value<String> draftUuid;
  final Value<String?> receiptNo;
  final Value<String> vendorName;
  final Value<String> receiptDate;
  final Value<String?> receiptTime;
  final Value<int> amount;
  final Value<String> mediaUuid;
  final Value<int?> serverReceiptId;
  final Value<int> rowid;
  const LocalReceiptsCompanion({
    this.clientUuid = const Value.absent(),
    this.lineUuid = const Value.absent(),
    this.draftUuid = const Value.absent(),
    this.receiptNo = const Value.absent(),
    this.vendorName = const Value.absent(),
    this.receiptDate = const Value.absent(),
    this.receiptTime = const Value.absent(),
    this.amount = const Value.absent(),
    this.mediaUuid = const Value.absent(),
    this.serverReceiptId = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  LocalReceiptsCompanion.insert({
    required String clientUuid,
    required String lineUuid,
    required String draftUuid,
    this.receiptNo = const Value.absent(),
    this.vendorName = const Value.absent(),
    required String receiptDate,
    this.receiptTime = const Value.absent(),
    required int amount,
    required String mediaUuid,
    this.serverReceiptId = const Value.absent(),
    this.rowid = const Value.absent(),
  }) : clientUuid = Value(clientUuid),
       lineUuid = Value(lineUuid),
       draftUuid = Value(draftUuid),
       receiptDate = Value(receiptDate),
       amount = Value(amount),
       mediaUuid = Value(mediaUuid);
  static Insertable<LocalReceipt> custom({
    Expression<String>? clientUuid,
    Expression<String>? lineUuid,
    Expression<String>? draftUuid,
    Expression<String>? receiptNo,
    Expression<String>? vendorName,
    Expression<String>? receiptDate,
    Expression<String>? receiptTime,
    Expression<int>? amount,
    Expression<String>? mediaUuid,
    Expression<int>? serverReceiptId,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (clientUuid != null) 'client_uuid': clientUuid,
      if (lineUuid != null) 'line_uuid': lineUuid,
      if (draftUuid != null) 'draft_uuid': draftUuid,
      if (receiptNo != null) 'receipt_no': receiptNo,
      if (vendorName != null) 'vendor_name': vendorName,
      if (receiptDate != null) 'receipt_date': receiptDate,
      if (receiptTime != null) 'receipt_time': receiptTime,
      if (amount != null) 'amount': amount,
      if (mediaUuid != null) 'media_uuid': mediaUuid,
      if (serverReceiptId != null) 'server_receipt_id': serverReceiptId,
      if (rowid != null) 'rowid': rowid,
    });
  }

  LocalReceiptsCompanion copyWith({
    Value<String>? clientUuid,
    Value<String>? lineUuid,
    Value<String>? draftUuid,
    Value<String?>? receiptNo,
    Value<String>? vendorName,
    Value<String>? receiptDate,
    Value<String?>? receiptTime,
    Value<int>? amount,
    Value<String>? mediaUuid,
    Value<int?>? serverReceiptId,
    Value<int>? rowid,
  }) {
    return LocalReceiptsCompanion(
      clientUuid: clientUuid ?? this.clientUuid,
      lineUuid: lineUuid ?? this.lineUuid,
      draftUuid: draftUuid ?? this.draftUuid,
      receiptNo: receiptNo ?? this.receiptNo,
      vendorName: vendorName ?? this.vendorName,
      receiptDate: receiptDate ?? this.receiptDate,
      receiptTime: receiptTime ?? this.receiptTime,
      amount: amount ?? this.amount,
      mediaUuid: mediaUuid ?? this.mediaUuid,
      serverReceiptId: serverReceiptId ?? this.serverReceiptId,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (clientUuid.present) {
      map['client_uuid'] = Variable<String>(clientUuid.value);
    }
    if (lineUuid.present) {
      map['line_uuid'] = Variable<String>(lineUuid.value);
    }
    if (draftUuid.present) {
      map['draft_uuid'] = Variable<String>(draftUuid.value);
    }
    if (receiptNo.present) {
      map['receipt_no'] = Variable<String>(receiptNo.value);
    }
    if (vendorName.present) {
      map['vendor_name'] = Variable<String>(vendorName.value);
    }
    if (receiptDate.present) {
      map['receipt_date'] = Variable<String>(receiptDate.value);
    }
    if (receiptTime.present) {
      map['receipt_time'] = Variable<String>(receiptTime.value);
    }
    if (amount.present) {
      map['amount'] = Variable<int>(amount.value);
    }
    if (mediaUuid.present) {
      map['media_uuid'] = Variable<String>(mediaUuid.value);
    }
    if (serverReceiptId.present) {
      map['server_receipt_id'] = Variable<int>(serverReceiptId.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('LocalReceiptsCompanion(')
          ..write('clientUuid: $clientUuid, ')
          ..write('lineUuid: $lineUuid, ')
          ..write('draftUuid: $draftUuid, ')
          ..write('receiptNo: $receiptNo, ')
          ..write('vendorName: $vendorName, ')
          ..write('receiptDate: $receiptDate, ')
          ..write('receiptTime: $receiptTime, ')
          ..write('amount: $amount, ')
          ..write('mediaUuid: $mediaUuid, ')
          ..write('serverReceiptId: $serverReceiptId, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

class $MediaBlobsTable extends MediaBlobs
    with TableInfo<$MediaBlobsTable, MediaBlob> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $MediaBlobsTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _clientUuidMeta = const VerificationMeta(
    'clientUuid',
  );
  @override
  late final GeneratedColumn<String> clientUuid = GeneratedColumn<String>(
    'client_uuid',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _userSubMeta = const VerificationMeta(
    'userSub',
  );
  @override
  late final GeneratedColumn<String> userSub = GeneratedColumn<String>(
    'user_sub',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _kindMeta = const VerificationMeta('kind');
  @override
  late final GeneratedColumn<String> kind = GeneratedColumn<String>(
    'kind',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _mimeTypeMeta = const VerificationMeta(
    'mimeType',
  );
  @override
  late final GeneratedColumn<String> mimeType = GeneratedColumn<String>(
    'mime_type',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
    defaultValue: const Constant('image/jpeg'),
  );
  static const VerificationMeta _bytesMeta = const VerificationMeta('bytes');
  @override
  late final GeneratedColumn<Uint8List> bytes = GeneratedColumn<Uint8List>(
    'bytes',
    aliasedName,
    false,
    type: DriftSqlType.blob,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _sha256Meta = const VerificationMeta('sha256');
  @override
  late final GeneratedColumn<String> sha256 = GeneratedColumn<String>(
    'sha256',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _sizeBytesMeta = const VerificationMeta(
    'sizeBytes',
  );
  @override
  late final GeneratedColumn<int> sizeBytes = GeneratedColumn<int>(
    'size_bytes',
    aliasedName,
    false,
    type: DriftSqlType.int,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _uploadedMeta = const VerificationMeta(
    'uploaded',
  );
  @override
  late final GeneratedColumn<bool> uploaded = GeneratedColumn<bool>(
    'uploaded',
    aliasedName,
    false,
    type: DriftSqlType.bool,
    requiredDuringInsert: false,
    defaultConstraints: GeneratedColumn.constraintIsAlways(
      'CHECK ("uploaded" IN (0, 1))',
    ),
    defaultValue: const Constant(false),
  );
  static const VerificationMeta _serverMediaIdMeta = const VerificationMeta(
    'serverMediaId',
  );
  @override
  late final GeneratedColumn<String> serverMediaId = GeneratedColumn<String>(
    'server_media_id',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _createdAtMeta = const VerificationMeta(
    'createdAt',
  );
  @override
  late final GeneratedColumn<DateTime> createdAt = GeneratedColumn<DateTime>(
    'created_at',
    aliasedName,
    false,
    type: DriftSqlType.dateTime,
    requiredDuringInsert: true,
  );
  @override
  List<GeneratedColumn> get $columns => [
    clientUuid,
    userSub,
    kind,
    mimeType,
    bytes,
    sha256,
    sizeBytes,
    uploaded,
    serverMediaId,
    createdAt,
  ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'media_blobs';
  @override
  VerificationContext validateIntegrity(
    Insertable<MediaBlob> instance, {
    bool isInserting = false,
  }) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('client_uuid')) {
      context.handle(
        _clientUuidMeta,
        clientUuid.isAcceptableOrUnknown(data['client_uuid']!, _clientUuidMeta),
      );
    } else if (isInserting) {
      context.missing(_clientUuidMeta);
    }
    if (data.containsKey('user_sub')) {
      context.handle(
        _userSubMeta,
        userSub.isAcceptableOrUnknown(data['user_sub']!, _userSubMeta),
      );
    } else if (isInserting) {
      context.missing(_userSubMeta);
    }
    if (data.containsKey('kind')) {
      context.handle(
        _kindMeta,
        kind.isAcceptableOrUnknown(data['kind']!, _kindMeta),
      );
    } else if (isInserting) {
      context.missing(_kindMeta);
    }
    if (data.containsKey('mime_type')) {
      context.handle(
        _mimeTypeMeta,
        mimeType.isAcceptableOrUnknown(data['mime_type']!, _mimeTypeMeta),
      );
    }
    if (data.containsKey('bytes')) {
      context.handle(
        _bytesMeta,
        bytes.isAcceptableOrUnknown(data['bytes']!, _bytesMeta),
      );
    } else if (isInserting) {
      context.missing(_bytesMeta);
    }
    if (data.containsKey('sha256')) {
      context.handle(
        _sha256Meta,
        sha256.isAcceptableOrUnknown(data['sha256']!, _sha256Meta),
      );
    } else if (isInserting) {
      context.missing(_sha256Meta);
    }
    if (data.containsKey('size_bytes')) {
      context.handle(
        _sizeBytesMeta,
        sizeBytes.isAcceptableOrUnknown(data['size_bytes']!, _sizeBytesMeta),
      );
    } else if (isInserting) {
      context.missing(_sizeBytesMeta);
    }
    if (data.containsKey('uploaded')) {
      context.handle(
        _uploadedMeta,
        uploaded.isAcceptableOrUnknown(data['uploaded']!, _uploadedMeta),
      );
    }
    if (data.containsKey('server_media_id')) {
      context.handle(
        _serverMediaIdMeta,
        serverMediaId.isAcceptableOrUnknown(
          data['server_media_id']!,
          _serverMediaIdMeta,
        ),
      );
    }
    if (data.containsKey('created_at')) {
      context.handle(
        _createdAtMeta,
        createdAt.isAcceptableOrUnknown(data['created_at']!, _createdAtMeta),
      );
    } else if (isInserting) {
      context.missing(_createdAtMeta);
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {clientUuid};
  @override
  MediaBlob map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return MediaBlob(
      clientUuid: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}client_uuid'],
      )!,
      userSub: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}user_sub'],
      )!,
      kind: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}kind'],
      )!,
      mimeType: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}mime_type'],
      )!,
      bytes: attachedDatabase.typeMapping.read(
        DriftSqlType.blob,
        data['${effectivePrefix}bytes'],
      )!,
      sha256: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}sha256'],
      )!,
      sizeBytes: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}size_bytes'],
      )!,
      uploaded: attachedDatabase.typeMapping.read(
        DriftSqlType.bool,
        data['${effectivePrefix}uploaded'],
      )!,
      serverMediaId: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}server_media_id'],
      ),
      createdAt: attachedDatabase.typeMapping.read(
        DriftSqlType.dateTime,
        data['${effectivePrefix}created_at'],
      )!,
    );
  }

  @override
  $MediaBlobsTable createAlias(String alias) {
    return $MediaBlobsTable(attachedDatabase, alias);
  }
}

class MediaBlob extends DataClass implements Insertable<MediaBlob> {
  final String clientUuid;
  final String userSub;
  final String kind;
  final String mimeType;
  final Uint8List bytes;
  final String sha256;
  final int sizeBytes;
  final bool uploaded;
  final String? serverMediaId;
  final DateTime createdAt;
  const MediaBlob({
    required this.clientUuid,
    required this.userSub,
    required this.kind,
    required this.mimeType,
    required this.bytes,
    required this.sha256,
    required this.sizeBytes,
    required this.uploaded,
    this.serverMediaId,
    required this.createdAt,
  });
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['client_uuid'] = Variable<String>(clientUuid);
    map['user_sub'] = Variable<String>(userSub);
    map['kind'] = Variable<String>(kind);
    map['mime_type'] = Variable<String>(mimeType);
    map['bytes'] = Variable<Uint8List>(bytes);
    map['sha256'] = Variable<String>(sha256);
    map['size_bytes'] = Variable<int>(sizeBytes);
    map['uploaded'] = Variable<bool>(uploaded);
    if (!nullToAbsent || serverMediaId != null) {
      map['server_media_id'] = Variable<String>(serverMediaId);
    }
    map['created_at'] = Variable<DateTime>(createdAt);
    return map;
  }

  MediaBlobsCompanion toCompanion(bool nullToAbsent) {
    return MediaBlobsCompanion(
      clientUuid: Value(clientUuid),
      userSub: Value(userSub),
      kind: Value(kind),
      mimeType: Value(mimeType),
      bytes: Value(bytes),
      sha256: Value(sha256),
      sizeBytes: Value(sizeBytes),
      uploaded: Value(uploaded),
      serverMediaId: serverMediaId == null && nullToAbsent
          ? const Value.absent()
          : Value(serverMediaId),
      createdAt: Value(createdAt),
    );
  }

  factory MediaBlob.fromJson(
    Map<String, dynamic> json, {
    ValueSerializer? serializer,
  }) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return MediaBlob(
      clientUuid: serializer.fromJson<String>(json['clientUuid']),
      userSub: serializer.fromJson<String>(json['userSub']),
      kind: serializer.fromJson<String>(json['kind']),
      mimeType: serializer.fromJson<String>(json['mimeType']),
      bytes: serializer.fromJson<Uint8List>(json['bytes']),
      sha256: serializer.fromJson<String>(json['sha256']),
      sizeBytes: serializer.fromJson<int>(json['sizeBytes']),
      uploaded: serializer.fromJson<bool>(json['uploaded']),
      serverMediaId: serializer.fromJson<String?>(json['serverMediaId']),
      createdAt: serializer.fromJson<DateTime>(json['createdAt']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'clientUuid': serializer.toJson<String>(clientUuid),
      'userSub': serializer.toJson<String>(userSub),
      'kind': serializer.toJson<String>(kind),
      'mimeType': serializer.toJson<String>(mimeType),
      'bytes': serializer.toJson<Uint8List>(bytes),
      'sha256': serializer.toJson<String>(sha256),
      'sizeBytes': serializer.toJson<int>(sizeBytes),
      'uploaded': serializer.toJson<bool>(uploaded),
      'serverMediaId': serializer.toJson<String?>(serverMediaId),
      'createdAt': serializer.toJson<DateTime>(createdAt),
    };
  }

  MediaBlob copyWith({
    String? clientUuid,
    String? userSub,
    String? kind,
    String? mimeType,
    Uint8List? bytes,
    String? sha256,
    int? sizeBytes,
    bool? uploaded,
    Value<String?> serverMediaId = const Value.absent(),
    DateTime? createdAt,
  }) => MediaBlob(
    clientUuid: clientUuid ?? this.clientUuid,
    userSub: userSub ?? this.userSub,
    kind: kind ?? this.kind,
    mimeType: mimeType ?? this.mimeType,
    bytes: bytes ?? this.bytes,
    sha256: sha256 ?? this.sha256,
    sizeBytes: sizeBytes ?? this.sizeBytes,
    uploaded: uploaded ?? this.uploaded,
    serverMediaId: serverMediaId.present
        ? serverMediaId.value
        : this.serverMediaId,
    createdAt: createdAt ?? this.createdAt,
  );
  MediaBlob copyWithCompanion(MediaBlobsCompanion data) {
    return MediaBlob(
      clientUuid: data.clientUuid.present
          ? data.clientUuid.value
          : this.clientUuid,
      userSub: data.userSub.present ? data.userSub.value : this.userSub,
      kind: data.kind.present ? data.kind.value : this.kind,
      mimeType: data.mimeType.present ? data.mimeType.value : this.mimeType,
      bytes: data.bytes.present ? data.bytes.value : this.bytes,
      sha256: data.sha256.present ? data.sha256.value : this.sha256,
      sizeBytes: data.sizeBytes.present ? data.sizeBytes.value : this.sizeBytes,
      uploaded: data.uploaded.present ? data.uploaded.value : this.uploaded,
      serverMediaId: data.serverMediaId.present
          ? data.serverMediaId.value
          : this.serverMediaId,
      createdAt: data.createdAt.present ? data.createdAt.value : this.createdAt,
    );
  }

  @override
  String toString() {
    return (StringBuffer('MediaBlob(')
          ..write('clientUuid: $clientUuid, ')
          ..write('userSub: $userSub, ')
          ..write('kind: $kind, ')
          ..write('mimeType: $mimeType, ')
          ..write('bytes: $bytes, ')
          ..write('sha256: $sha256, ')
          ..write('sizeBytes: $sizeBytes, ')
          ..write('uploaded: $uploaded, ')
          ..write('serverMediaId: $serverMediaId, ')
          ..write('createdAt: $createdAt')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(
    clientUuid,
    userSub,
    kind,
    mimeType,
    $driftBlobEquality.hash(bytes),
    sha256,
    sizeBytes,
    uploaded,
    serverMediaId,
    createdAt,
  );
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is MediaBlob &&
          other.clientUuid == this.clientUuid &&
          other.userSub == this.userSub &&
          other.kind == this.kind &&
          other.mimeType == this.mimeType &&
          $driftBlobEquality.equals(other.bytes, this.bytes) &&
          other.sha256 == this.sha256 &&
          other.sizeBytes == this.sizeBytes &&
          other.uploaded == this.uploaded &&
          other.serverMediaId == this.serverMediaId &&
          other.createdAt == this.createdAt);
}

class MediaBlobsCompanion extends UpdateCompanion<MediaBlob> {
  final Value<String> clientUuid;
  final Value<String> userSub;
  final Value<String> kind;
  final Value<String> mimeType;
  final Value<Uint8List> bytes;
  final Value<String> sha256;
  final Value<int> sizeBytes;
  final Value<bool> uploaded;
  final Value<String?> serverMediaId;
  final Value<DateTime> createdAt;
  final Value<int> rowid;
  const MediaBlobsCompanion({
    this.clientUuid = const Value.absent(),
    this.userSub = const Value.absent(),
    this.kind = const Value.absent(),
    this.mimeType = const Value.absent(),
    this.bytes = const Value.absent(),
    this.sha256 = const Value.absent(),
    this.sizeBytes = const Value.absent(),
    this.uploaded = const Value.absent(),
    this.serverMediaId = const Value.absent(),
    this.createdAt = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  MediaBlobsCompanion.insert({
    required String clientUuid,
    required String userSub,
    required String kind,
    this.mimeType = const Value.absent(),
    required Uint8List bytes,
    required String sha256,
    required int sizeBytes,
    this.uploaded = const Value.absent(),
    this.serverMediaId = const Value.absent(),
    required DateTime createdAt,
    this.rowid = const Value.absent(),
  }) : clientUuid = Value(clientUuid),
       userSub = Value(userSub),
       kind = Value(kind),
       bytes = Value(bytes),
       sha256 = Value(sha256),
       sizeBytes = Value(sizeBytes),
       createdAt = Value(createdAt);
  static Insertable<MediaBlob> custom({
    Expression<String>? clientUuid,
    Expression<String>? userSub,
    Expression<String>? kind,
    Expression<String>? mimeType,
    Expression<Uint8List>? bytes,
    Expression<String>? sha256,
    Expression<int>? sizeBytes,
    Expression<bool>? uploaded,
    Expression<String>? serverMediaId,
    Expression<DateTime>? createdAt,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (clientUuid != null) 'client_uuid': clientUuid,
      if (userSub != null) 'user_sub': userSub,
      if (kind != null) 'kind': kind,
      if (mimeType != null) 'mime_type': mimeType,
      if (bytes != null) 'bytes': bytes,
      if (sha256 != null) 'sha256': sha256,
      if (sizeBytes != null) 'size_bytes': sizeBytes,
      if (uploaded != null) 'uploaded': uploaded,
      if (serverMediaId != null) 'server_media_id': serverMediaId,
      if (createdAt != null) 'created_at': createdAt,
      if (rowid != null) 'rowid': rowid,
    });
  }

  MediaBlobsCompanion copyWith({
    Value<String>? clientUuid,
    Value<String>? userSub,
    Value<String>? kind,
    Value<String>? mimeType,
    Value<Uint8List>? bytes,
    Value<String>? sha256,
    Value<int>? sizeBytes,
    Value<bool>? uploaded,
    Value<String?>? serverMediaId,
    Value<DateTime>? createdAt,
    Value<int>? rowid,
  }) {
    return MediaBlobsCompanion(
      clientUuid: clientUuid ?? this.clientUuid,
      userSub: userSub ?? this.userSub,
      kind: kind ?? this.kind,
      mimeType: mimeType ?? this.mimeType,
      bytes: bytes ?? this.bytes,
      sha256: sha256 ?? this.sha256,
      sizeBytes: sizeBytes ?? this.sizeBytes,
      uploaded: uploaded ?? this.uploaded,
      serverMediaId: serverMediaId ?? this.serverMediaId,
      createdAt: createdAt ?? this.createdAt,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (clientUuid.present) {
      map['client_uuid'] = Variable<String>(clientUuid.value);
    }
    if (userSub.present) {
      map['user_sub'] = Variable<String>(userSub.value);
    }
    if (kind.present) {
      map['kind'] = Variable<String>(kind.value);
    }
    if (mimeType.present) {
      map['mime_type'] = Variable<String>(mimeType.value);
    }
    if (bytes.present) {
      map['bytes'] = Variable<Uint8List>(bytes.value);
    }
    if (sha256.present) {
      map['sha256'] = Variable<String>(sha256.value);
    }
    if (sizeBytes.present) {
      map['size_bytes'] = Variable<int>(sizeBytes.value);
    }
    if (uploaded.present) {
      map['uploaded'] = Variable<bool>(uploaded.value);
    }
    if (serverMediaId.present) {
      map['server_media_id'] = Variable<String>(serverMediaId.value);
    }
    if (createdAt.present) {
      map['created_at'] = Variable<DateTime>(createdAt.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('MediaBlobsCompanion(')
          ..write('clientUuid: $clientUuid, ')
          ..write('userSub: $userSub, ')
          ..write('kind: $kind, ')
          ..write('mimeType: $mimeType, ')
          ..write('bytes: $bytes, ')
          ..write('sha256: $sha256, ')
          ..write('sizeBytes: $sizeBytes, ')
          ..write('uploaded: $uploaded, ')
          ..write('serverMediaId: $serverMediaId, ')
          ..write('createdAt: $createdAt, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

class $OutboxTable extends Outbox with TableInfo<$OutboxTable, OutboxData> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $OutboxTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _opUuidMeta = const VerificationMeta('opUuid');
  @override
  late final GeneratedColumn<String> opUuid = GeneratedColumn<String>(
    'op_uuid',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _userSubMeta = const VerificationMeta(
    'userSub',
  );
  @override
  late final GeneratedColumn<String> userSub = GeneratedColumn<String>(
    'user_sub',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _companyIdMeta = const VerificationMeta(
    'companyId',
  );
  @override
  late final GeneratedColumn<int> companyId = GeneratedColumn<int>(
    'company_id',
    aliasedName,
    true,
    type: DriftSqlType.int,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _siteIdMeta = const VerificationMeta('siteId');
  @override
  late final GeneratedColumn<int> siteId = GeneratedColumn<int>(
    'site_id',
    aliasedName,
    true,
    type: DriftSqlType.int,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _typeMeta = const VerificationMeta('type');
  @override
  late final GeneratedColumn<String> type = GeneratedColumn<String>(
    'type',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _targetUuidMeta = const VerificationMeta(
    'targetUuid',
  );
  @override
  late final GeneratedColumn<String> targetUuid = GeneratedColumn<String>(
    'target_uuid',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _payloadJsonMeta = const VerificationMeta(
    'payloadJson',
  );
  @override
  late final GeneratedColumn<String> payloadJson = GeneratedColumn<String>(
    'payload_json',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _baseRevMeta = const VerificationMeta(
    'baseRev',
  );
  @override
  late final GeneratedColumn<int> baseRev = GeneratedColumn<int>(
    'base_rev',
    aliasedName,
    true,
    type: DriftSqlType.int,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _dependsOnJsonMeta = const VerificationMeta(
    'dependsOnJson',
  );
  @override
  late final GeneratedColumn<String> dependsOnJson = GeneratedColumn<String>(
    'depends_on_json',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
    defaultValue: const Constant('[]'),
  );
  static const VerificationMeta _deviceTimeMeta = const VerificationMeta(
    'deviceTime',
  );
  @override
  late final GeneratedColumn<String> deviceTime = GeneratedColumn<String>(
    'device_time',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _elapsedMsMeta = const VerificationMeta(
    'elapsedMs',
  );
  @override
  late final GeneratedColumn<int> elapsedMs = GeneratedColumn<int>(
    'elapsed_ms',
    aliasedName,
    false,
    type: DriftSqlType.int,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _bootIdMeta = const VerificationMeta('bootId');
  @override
  late final GeneratedColumn<String> bootId = GeneratedColumn<String>(
    'boot_id',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _offlineMeta = const VerificationMeta(
    'offline',
  );
  @override
  late final GeneratedColumn<bool> offline = GeneratedColumn<bool>(
    'offline',
    aliasedName,
    false,
    type: DriftSqlType.bool,
    requiredDuringInsert: false,
    defaultConstraints: GeneratedColumn.constraintIsAlways(
      'CHECK ("offline" IN (0, 1))',
    ),
    defaultValue: const Constant(true),
  );
  static const VerificationMeta _statusMeta = const VerificationMeta('status');
  @override
  late final GeneratedColumn<String> status = GeneratedColumn<String>(
    'status',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
    defaultValue: const Constant('pending'),
  );
  static const VerificationMeta _attemptsMeta = const VerificationMeta(
    'attempts',
  );
  @override
  late final GeneratedColumn<int> attempts = GeneratedColumn<int>(
    'attempts',
    aliasedName,
    false,
    type: DriftSqlType.int,
    requiredDuringInsert: false,
    defaultValue: const Constant(0),
  );
  static const VerificationMeta _nextAttemptAtMeta = const VerificationMeta(
    'nextAttemptAt',
  );
  @override
  late final GeneratedColumn<DateTime> nextAttemptAt =
      GeneratedColumn<DateTime>(
        'next_attempt_at',
        aliasedName,
        true,
        type: DriftSqlType.dateTime,
        requiredDuringInsert: false,
      );
  static const VerificationMeta _lastErrorCodeMeta = const VerificationMeta(
    'lastErrorCode',
  );
  @override
  late final GeneratedColumn<String> lastErrorCode = GeneratedColumn<String>(
    'last_error_code',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _lastErrorMessageMeta = const VerificationMeta(
    'lastErrorMessage',
  );
  @override
  late final GeneratedColumn<String> lastErrorMessage = GeneratedColumn<String>(
    'last_error_message',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _createdAtMeta = const VerificationMeta(
    'createdAt',
  );
  @override
  late final GeneratedColumn<DateTime> createdAt = GeneratedColumn<DateTime>(
    'created_at',
    aliasedName,
    false,
    type: DriftSqlType.dateTime,
    requiredDuringInsert: true,
  );
  @override
  List<GeneratedColumn> get $columns => [
    opUuid,
    userSub,
    companyId,
    siteId,
    type,
    targetUuid,
    payloadJson,
    baseRev,
    dependsOnJson,
    deviceTime,
    elapsedMs,
    bootId,
    offline,
    status,
    attempts,
    nextAttemptAt,
    lastErrorCode,
    lastErrorMessage,
    createdAt,
  ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'outbox';
  @override
  VerificationContext validateIntegrity(
    Insertable<OutboxData> instance, {
    bool isInserting = false,
  }) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('op_uuid')) {
      context.handle(
        _opUuidMeta,
        opUuid.isAcceptableOrUnknown(data['op_uuid']!, _opUuidMeta),
      );
    } else if (isInserting) {
      context.missing(_opUuidMeta);
    }
    if (data.containsKey('user_sub')) {
      context.handle(
        _userSubMeta,
        userSub.isAcceptableOrUnknown(data['user_sub']!, _userSubMeta),
      );
    } else if (isInserting) {
      context.missing(_userSubMeta);
    }
    if (data.containsKey('company_id')) {
      context.handle(
        _companyIdMeta,
        companyId.isAcceptableOrUnknown(data['company_id']!, _companyIdMeta),
      );
    }
    if (data.containsKey('site_id')) {
      context.handle(
        _siteIdMeta,
        siteId.isAcceptableOrUnknown(data['site_id']!, _siteIdMeta),
      );
    }
    if (data.containsKey('type')) {
      context.handle(
        _typeMeta,
        type.isAcceptableOrUnknown(data['type']!, _typeMeta),
      );
    } else if (isInserting) {
      context.missing(_typeMeta);
    }
    if (data.containsKey('target_uuid')) {
      context.handle(
        _targetUuidMeta,
        targetUuid.isAcceptableOrUnknown(data['target_uuid']!, _targetUuidMeta),
      );
    } else if (isInserting) {
      context.missing(_targetUuidMeta);
    }
    if (data.containsKey('payload_json')) {
      context.handle(
        _payloadJsonMeta,
        payloadJson.isAcceptableOrUnknown(
          data['payload_json']!,
          _payloadJsonMeta,
        ),
      );
    } else if (isInserting) {
      context.missing(_payloadJsonMeta);
    }
    if (data.containsKey('base_rev')) {
      context.handle(
        _baseRevMeta,
        baseRev.isAcceptableOrUnknown(data['base_rev']!, _baseRevMeta),
      );
    }
    if (data.containsKey('depends_on_json')) {
      context.handle(
        _dependsOnJsonMeta,
        dependsOnJson.isAcceptableOrUnknown(
          data['depends_on_json']!,
          _dependsOnJsonMeta,
        ),
      );
    }
    if (data.containsKey('device_time')) {
      context.handle(
        _deviceTimeMeta,
        deviceTime.isAcceptableOrUnknown(data['device_time']!, _deviceTimeMeta),
      );
    } else if (isInserting) {
      context.missing(_deviceTimeMeta);
    }
    if (data.containsKey('elapsed_ms')) {
      context.handle(
        _elapsedMsMeta,
        elapsedMs.isAcceptableOrUnknown(data['elapsed_ms']!, _elapsedMsMeta),
      );
    } else if (isInserting) {
      context.missing(_elapsedMsMeta);
    }
    if (data.containsKey('boot_id')) {
      context.handle(
        _bootIdMeta,
        bootId.isAcceptableOrUnknown(data['boot_id']!, _bootIdMeta),
      );
    } else if (isInserting) {
      context.missing(_bootIdMeta);
    }
    if (data.containsKey('offline')) {
      context.handle(
        _offlineMeta,
        offline.isAcceptableOrUnknown(data['offline']!, _offlineMeta),
      );
    }
    if (data.containsKey('status')) {
      context.handle(
        _statusMeta,
        status.isAcceptableOrUnknown(data['status']!, _statusMeta),
      );
    }
    if (data.containsKey('attempts')) {
      context.handle(
        _attemptsMeta,
        attempts.isAcceptableOrUnknown(data['attempts']!, _attemptsMeta),
      );
    }
    if (data.containsKey('next_attempt_at')) {
      context.handle(
        _nextAttemptAtMeta,
        nextAttemptAt.isAcceptableOrUnknown(
          data['next_attempt_at']!,
          _nextAttemptAtMeta,
        ),
      );
    }
    if (data.containsKey('last_error_code')) {
      context.handle(
        _lastErrorCodeMeta,
        lastErrorCode.isAcceptableOrUnknown(
          data['last_error_code']!,
          _lastErrorCodeMeta,
        ),
      );
    }
    if (data.containsKey('last_error_message')) {
      context.handle(
        _lastErrorMessageMeta,
        lastErrorMessage.isAcceptableOrUnknown(
          data['last_error_message']!,
          _lastErrorMessageMeta,
        ),
      );
    }
    if (data.containsKey('created_at')) {
      context.handle(
        _createdAtMeta,
        createdAt.isAcceptableOrUnknown(data['created_at']!, _createdAtMeta),
      );
    } else if (isInserting) {
      context.missing(_createdAtMeta);
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {opUuid};
  @override
  OutboxData map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return OutboxData(
      opUuid: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}op_uuid'],
      )!,
      userSub: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}user_sub'],
      )!,
      companyId: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}company_id'],
      ),
      siteId: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}site_id'],
      ),
      type: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}type'],
      )!,
      targetUuid: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}target_uuid'],
      )!,
      payloadJson: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}payload_json'],
      )!,
      baseRev: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}base_rev'],
      ),
      dependsOnJson: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}depends_on_json'],
      )!,
      deviceTime: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}device_time'],
      )!,
      elapsedMs: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}elapsed_ms'],
      )!,
      bootId: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}boot_id'],
      )!,
      offline: attachedDatabase.typeMapping.read(
        DriftSqlType.bool,
        data['${effectivePrefix}offline'],
      )!,
      status: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}status'],
      )!,
      attempts: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}attempts'],
      )!,
      nextAttemptAt: attachedDatabase.typeMapping.read(
        DriftSqlType.dateTime,
        data['${effectivePrefix}next_attempt_at'],
      ),
      lastErrorCode: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}last_error_code'],
      ),
      lastErrorMessage: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}last_error_message'],
      ),
      createdAt: attachedDatabase.typeMapping.read(
        DriftSqlType.dateTime,
        data['${effectivePrefix}created_at'],
      )!,
    );
  }

  @override
  $OutboxTable createAlias(String alias) {
    return $OutboxTable(attachedDatabase, alias);
  }
}

class OutboxData extends DataClass implements Insertable<OutboxData> {
  final String opUuid;
  final String userSub;

  /// MC3 (schema v3): PT of the item, sent as `company_id` (the item's own PT, never the switcher
  /// selection). Null = queued before v3: assigned when the user has one PT, else held until chosen.
  final int? companyId;

  /// Schema v9 (ADR 0023): site (kantor cabang) of an attendance item at a site — the same id as `payload.site_id`,
  /// kept as a column so the attendance history resolves the location without parsing the payload. Null for every
  /// other item (projects, cost centers, expense / report items) and for rows queued before v9.
  final int? siteId;
  final String type;
  final String targetUuid;
  final String payloadJson;
  final int? baseRev;
  final String dependsOnJson;
  final String deviceTime;
  final int elapsedMs;
  final String bootId;
  final bool offline;

  /// pending | applied | rejected | conflict | failed
  final String status;
  final int attempts;
  final DateTime? nextAttemptAt;
  final String? lastErrorCode;
  final String? lastErrorMessage;
  final DateTime createdAt;
  const OutboxData({
    required this.opUuid,
    required this.userSub,
    this.companyId,
    this.siteId,
    required this.type,
    required this.targetUuid,
    required this.payloadJson,
    this.baseRev,
    required this.dependsOnJson,
    required this.deviceTime,
    required this.elapsedMs,
    required this.bootId,
    required this.offline,
    required this.status,
    required this.attempts,
    this.nextAttemptAt,
    this.lastErrorCode,
    this.lastErrorMessage,
    required this.createdAt,
  });
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['op_uuid'] = Variable<String>(opUuid);
    map['user_sub'] = Variable<String>(userSub);
    if (!nullToAbsent || companyId != null) {
      map['company_id'] = Variable<int>(companyId);
    }
    if (!nullToAbsent || siteId != null) {
      map['site_id'] = Variable<int>(siteId);
    }
    map['type'] = Variable<String>(type);
    map['target_uuid'] = Variable<String>(targetUuid);
    map['payload_json'] = Variable<String>(payloadJson);
    if (!nullToAbsent || baseRev != null) {
      map['base_rev'] = Variable<int>(baseRev);
    }
    map['depends_on_json'] = Variable<String>(dependsOnJson);
    map['device_time'] = Variable<String>(deviceTime);
    map['elapsed_ms'] = Variable<int>(elapsedMs);
    map['boot_id'] = Variable<String>(bootId);
    map['offline'] = Variable<bool>(offline);
    map['status'] = Variable<String>(status);
    map['attempts'] = Variable<int>(attempts);
    if (!nullToAbsent || nextAttemptAt != null) {
      map['next_attempt_at'] = Variable<DateTime>(nextAttemptAt);
    }
    if (!nullToAbsent || lastErrorCode != null) {
      map['last_error_code'] = Variable<String>(lastErrorCode);
    }
    if (!nullToAbsent || lastErrorMessage != null) {
      map['last_error_message'] = Variable<String>(lastErrorMessage);
    }
    map['created_at'] = Variable<DateTime>(createdAt);
    return map;
  }

  OutboxCompanion toCompanion(bool nullToAbsent) {
    return OutboxCompanion(
      opUuid: Value(opUuid),
      userSub: Value(userSub),
      companyId: companyId == null && nullToAbsent
          ? const Value.absent()
          : Value(companyId),
      siteId: siteId == null && nullToAbsent
          ? const Value.absent()
          : Value(siteId),
      type: Value(type),
      targetUuid: Value(targetUuid),
      payloadJson: Value(payloadJson),
      baseRev: baseRev == null && nullToAbsent
          ? const Value.absent()
          : Value(baseRev),
      dependsOnJson: Value(dependsOnJson),
      deviceTime: Value(deviceTime),
      elapsedMs: Value(elapsedMs),
      bootId: Value(bootId),
      offline: Value(offline),
      status: Value(status),
      attempts: Value(attempts),
      nextAttemptAt: nextAttemptAt == null && nullToAbsent
          ? const Value.absent()
          : Value(nextAttemptAt),
      lastErrorCode: lastErrorCode == null && nullToAbsent
          ? const Value.absent()
          : Value(lastErrorCode),
      lastErrorMessage: lastErrorMessage == null && nullToAbsent
          ? const Value.absent()
          : Value(lastErrorMessage),
      createdAt: Value(createdAt),
    );
  }

  factory OutboxData.fromJson(
    Map<String, dynamic> json, {
    ValueSerializer? serializer,
  }) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return OutboxData(
      opUuid: serializer.fromJson<String>(json['opUuid']),
      userSub: serializer.fromJson<String>(json['userSub']),
      companyId: serializer.fromJson<int?>(json['companyId']),
      siteId: serializer.fromJson<int?>(json['siteId']),
      type: serializer.fromJson<String>(json['type']),
      targetUuid: serializer.fromJson<String>(json['targetUuid']),
      payloadJson: serializer.fromJson<String>(json['payloadJson']),
      baseRev: serializer.fromJson<int?>(json['baseRev']),
      dependsOnJson: serializer.fromJson<String>(json['dependsOnJson']),
      deviceTime: serializer.fromJson<String>(json['deviceTime']),
      elapsedMs: serializer.fromJson<int>(json['elapsedMs']),
      bootId: serializer.fromJson<String>(json['bootId']),
      offline: serializer.fromJson<bool>(json['offline']),
      status: serializer.fromJson<String>(json['status']),
      attempts: serializer.fromJson<int>(json['attempts']),
      nextAttemptAt: serializer.fromJson<DateTime?>(json['nextAttemptAt']),
      lastErrorCode: serializer.fromJson<String?>(json['lastErrorCode']),
      lastErrorMessage: serializer.fromJson<String?>(json['lastErrorMessage']),
      createdAt: serializer.fromJson<DateTime>(json['createdAt']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'opUuid': serializer.toJson<String>(opUuid),
      'userSub': serializer.toJson<String>(userSub),
      'companyId': serializer.toJson<int?>(companyId),
      'siteId': serializer.toJson<int?>(siteId),
      'type': serializer.toJson<String>(type),
      'targetUuid': serializer.toJson<String>(targetUuid),
      'payloadJson': serializer.toJson<String>(payloadJson),
      'baseRev': serializer.toJson<int?>(baseRev),
      'dependsOnJson': serializer.toJson<String>(dependsOnJson),
      'deviceTime': serializer.toJson<String>(deviceTime),
      'elapsedMs': serializer.toJson<int>(elapsedMs),
      'bootId': serializer.toJson<String>(bootId),
      'offline': serializer.toJson<bool>(offline),
      'status': serializer.toJson<String>(status),
      'attempts': serializer.toJson<int>(attempts),
      'nextAttemptAt': serializer.toJson<DateTime?>(nextAttemptAt),
      'lastErrorCode': serializer.toJson<String?>(lastErrorCode),
      'lastErrorMessage': serializer.toJson<String?>(lastErrorMessage),
      'createdAt': serializer.toJson<DateTime>(createdAt),
    };
  }

  OutboxData copyWith({
    String? opUuid,
    String? userSub,
    Value<int?> companyId = const Value.absent(),
    Value<int?> siteId = const Value.absent(),
    String? type,
    String? targetUuid,
    String? payloadJson,
    Value<int?> baseRev = const Value.absent(),
    String? dependsOnJson,
    String? deviceTime,
    int? elapsedMs,
    String? bootId,
    bool? offline,
    String? status,
    int? attempts,
    Value<DateTime?> nextAttemptAt = const Value.absent(),
    Value<String?> lastErrorCode = const Value.absent(),
    Value<String?> lastErrorMessage = const Value.absent(),
    DateTime? createdAt,
  }) => OutboxData(
    opUuid: opUuid ?? this.opUuid,
    userSub: userSub ?? this.userSub,
    companyId: companyId.present ? companyId.value : this.companyId,
    siteId: siteId.present ? siteId.value : this.siteId,
    type: type ?? this.type,
    targetUuid: targetUuid ?? this.targetUuid,
    payloadJson: payloadJson ?? this.payloadJson,
    baseRev: baseRev.present ? baseRev.value : this.baseRev,
    dependsOnJson: dependsOnJson ?? this.dependsOnJson,
    deviceTime: deviceTime ?? this.deviceTime,
    elapsedMs: elapsedMs ?? this.elapsedMs,
    bootId: bootId ?? this.bootId,
    offline: offline ?? this.offline,
    status: status ?? this.status,
    attempts: attempts ?? this.attempts,
    nextAttemptAt: nextAttemptAt.present
        ? nextAttemptAt.value
        : this.nextAttemptAt,
    lastErrorCode: lastErrorCode.present
        ? lastErrorCode.value
        : this.lastErrorCode,
    lastErrorMessage: lastErrorMessage.present
        ? lastErrorMessage.value
        : this.lastErrorMessage,
    createdAt: createdAt ?? this.createdAt,
  );
  OutboxData copyWithCompanion(OutboxCompanion data) {
    return OutboxData(
      opUuid: data.opUuid.present ? data.opUuid.value : this.opUuid,
      userSub: data.userSub.present ? data.userSub.value : this.userSub,
      companyId: data.companyId.present ? data.companyId.value : this.companyId,
      siteId: data.siteId.present ? data.siteId.value : this.siteId,
      type: data.type.present ? data.type.value : this.type,
      targetUuid: data.targetUuid.present
          ? data.targetUuid.value
          : this.targetUuid,
      payloadJson: data.payloadJson.present
          ? data.payloadJson.value
          : this.payloadJson,
      baseRev: data.baseRev.present ? data.baseRev.value : this.baseRev,
      dependsOnJson: data.dependsOnJson.present
          ? data.dependsOnJson.value
          : this.dependsOnJson,
      deviceTime: data.deviceTime.present
          ? data.deviceTime.value
          : this.deviceTime,
      elapsedMs: data.elapsedMs.present ? data.elapsedMs.value : this.elapsedMs,
      bootId: data.bootId.present ? data.bootId.value : this.bootId,
      offline: data.offline.present ? data.offline.value : this.offline,
      status: data.status.present ? data.status.value : this.status,
      attempts: data.attempts.present ? data.attempts.value : this.attempts,
      nextAttemptAt: data.nextAttemptAt.present
          ? data.nextAttemptAt.value
          : this.nextAttemptAt,
      lastErrorCode: data.lastErrorCode.present
          ? data.lastErrorCode.value
          : this.lastErrorCode,
      lastErrorMessage: data.lastErrorMessage.present
          ? data.lastErrorMessage.value
          : this.lastErrorMessage,
      createdAt: data.createdAt.present ? data.createdAt.value : this.createdAt,
    );
  }

  @override
  String toString() {
    return (StringBuffer('OutboxData(')
          ..write('opUuid: $opUuid, ')
          ..write('userSub: $userSub, ')
          ..write('companyId: $companyId, ')
          ..write('siteId: $siteId, ')
          ..write('type: $type, ')
          ..write('targetUuid: $targetUuid, ')
          ..write('payloadJson: $payloadJson, ')
          ..write('baseRev: $baseRev, ')
          ..write('dependsOnJson: $dependsOnJson, ')
          ..write('deviceTime: $deviceTime, ')
          ..write('elapsedMs: $elapsedMs, ')
          ..write('bootId: $bootId, ')
          ..write('offline: $offline, ')
          ..write('status: $status, ')
          ..write('attempts: $attempts, ')
          ..write('nextAttemptAt: $nextAttemptAt, ')
          ..write('lastErrorCode: $lastErrorCode, ')
          ..write('lastErrorMessage: $lastErrorMessage, ')
          ..write('createdAt: $createdAt')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(
    opUuid,
    userSub,
    companyId,
    siteId,
    type,
    targetUuid,
    payloadJson,
    baseRev,
    dependsOnJson,
    deviceTime,
    elapsedMs,
    bootId,
    offline,
    status,
    attempts,
    nextAttemptAt,
    lastErrorCode,
    lastErrorMessage,
    createdAt,
  );
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is OutboxData &&
          other.opUuid == this.opUuid &&
          other.userSub == this.userSub &&
          other.companyId == this.companyId &&
          other.siteId == this.siteId &&
          other.type == this.type &&
          other.targetUuid == this.targetUuid &&
          other.payloadJson == this.payloadJson &&
          other.baseRev == this.baseRev &&
          other.dependsOnJson == this.dependsOnJson &&
          other.deviceTime == this.deviceTime &&
          other.elapsedMs == this.elapsedMs &&
          other.bootId == this.bootId &&
          other.offline == this.offline &&
          other.status == this.status &&
          other.attempts == this.attempts &&
          other.nextAttemptAt == this.nextAttemptAt &&
          other.lastErrorCode == this.lastErrorCode &&
          other.lastErrorMessage == this.lastErrorMessage &&
          other.createdAt == this.createdAt);
}

class OutboxCompanion extends UpdateCompanion<OutboxData> {
  final Value<String> opUuid;
  final Value<String> userSub;
  final Value<int?> companyId;
  final Value<int?> siteId;
  final Value<String> type;
  final Value<String> targetUuid;
  final Value<String> payloadJson;
  final Value<int?> baseRev;
  final Value<String> dependsOnJson;
  final Value<String> deviceTime;
  final Value<int> elapsedMs;
  final Value<String> bootId;
  final Value<bool> offline;
  final Value<String> status;
  final Value<int> attempts;
  final Value<DateTime?> nextAttemptAt;
  final Value<String?> lastErrorCode;
  final Value<String?> lastErrorMessage;
  final Value<DateTime> createdAt;
  final Value<int> rowid;
  const OutboxCompanion({
    this.opUuid = const Value.absent(),
    this.userSub = const Value.absent(),
    this.companyId = const Value.absent(),
    this.siteId = const Value.absent(),
    this.type = const Value.absent(),
    this.targetUuid = const Value.absent(),
    this.payloadJson = const Value.absent(),
    this.baseRev = const Value.absent(),
    this.dependsOnJson = const Value.absent(),
    this.deviceTime = const Value.absent(),
    this.elapsedMs = const Value.absent(),
    this.bootId = const Value.absent(),
    this.offline = const Value.absent(),
    this.status = const Value.absent(),
    this.attempts = const Value.absent(),
    this.nextAttemptAt = const Value.absent(),
    this.lastErrorCode = const Value.absent(),
    this.lastErrorMessage = const Value.absent(),
    this.createdAt = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  OutboxCompanion.insert({
    required String opUuid,
    required String userSub,
    this.companyId = const Value.absent(),
    this.siteId = const Value.absent(),
    required String type,
    required String targetUuid,
    required String payloadJson,
    this.baseRev = const Value.absent(),
    this.dependsOnJson = const Value.absent(),
    required String deviceTime,
    required int elapsedMs,
    required String bootId,
    this.offline = const Value.absent(),
    this.status = const Value.absent(),
    this.attempts = const Value.absent(),
    this.nextAttemptAt = const Value.absent(),
    this.lastErrorCode = const Value.absent(),
    this.lastErrorMessage = const Value.absent(),
    required DateTime createdAt,
    this.rowid = const Value.absent(),
  }) : opUuid = Value(opUuid),
       userSub = Value(userSub),
       type = Value(type),
       targetUuid = Value(targetUuid),
       payloadJson = Value(payloadJson),
       deviceTime = Value(deviceTime),
       elapsedMs = Value(elapsedMs),
       bootId = Value(bootId),
       createdAt = Value(createdAt);
  static Insertable<OutboxData> custom({
    Expression<String>? opUuid,
    Expression<String>? userSub,
    Expression<int>? companyId,
    Expression<int>? siteId,
    Expression<String>? type,
    Expression<String>? targetUuid,
    Expression<String>? payloadJson,
    Expression<int>? baseRev,
    Expression<String>? dependsOnJson,
    Expression<String>? deviceTime,
    Expression<int>? elapsedMs,
    Expression<String>? bootId,
    Expression<bool>? offline,
    Expression<String>? status,
    Expression<int>? attempts,
    Expression<DateTime>? nextAttemptAt,
    Expression<String>? lastErrorCode,
    Expression<String>? lastErrorMessage,
    Expression<DateTime>? createdAt,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (opUuid != null) 'op_uuid': opUuid,
      if (userSub != null) 'user_sub': userSub,
      if (companyId != null) 'company_id': companyId,
      if (siteId != null) 'site_id': siteId,
      if (type != null) 'type': type,
      if (targetUuid != null) 'target_uuid': targetUuid,
      if (payloadJson != null) 'payload_json': payloadJson,
      if (baseRev != null) 'base_rev': baseRev,
      if (dependsOnJson != null) 'depends_on_json': dependsOnJson,
      if (deviceTime != null) 'device_time': deviceTime,
      if (elapsedMs != null) 'elapsed_ms': elapsedMs,
      if (bootId != null) 'boot_id': bootId,
      if (offline != null) 'offline': offline,
      if (status != null) 'status': status,
      if (attempts != null) 'attempts': attempts,
      if (nextAttemptAt != null) 'next_attempt_at': nextAttemptAt,
      if (lastErrorCode != null) 'last_error_code': lastErrorCode,
      if (lastErrorMessage != null) 'last_error_message': lastErrorMessage,
      if (createdAt != null) 'created_at': createdAt,
      if (rowid != null) 'rowid': rowid,
    });
  }

  OutboxCompanion copyWith({
    Value<String>? opUuid,
    Value<String>? userSub,
    Value<int?>? companyId,
    Value<int?>? siteId,
    Value<String>? type,
    Value<String>? targetUuid,
    Value<String>? payloadJson,
    Value<int?>? baseRev,
    Value<String>? dependsOnJson,
    Value<String>? deviceTime,
    Value<int>? elapsedMs,
    Value<String>? bootId,
    Value<bool>? offline,
    Value<String>? status,
    Value<int>? attempts,
    Value<DateTime?>? nextAttemptAt,
    Value<String?>? lastErrorCode,
    Value<String?>? lastErrorMessage,
    Value<DateTime>? createdAt,
    Value<int>? rowid,
  }) {
    return OutboxCompanion(
      opUuid: opUuid ?? this.opUuid,
      userSub: userSub ?? this.userSub,
      companyId: companyId ?? this.companyId,
      siteId: siteId ?? this.siteId,
      type: type ?? this.type,
      targetUuid: targetUuid ?? this.targetUuid,
      payloadJson: payloadJson ?? this.payloadJson,
      baseRev: baseRev ?? this.baseRev,
      dependsOnJson: dependsOnJson ?? this.dependsOnJson,
      deviceTime: deviceTime ?? this.deviceTime,
      elapsedMs: elapsedMs ?? this.elapsedMs,
      bootId: bootId ?? this.bootId,
      offline: offline ?? this.offline,
      status: status ?? this.status,
      attempts: attempts ?? this.attempts,
      nextAttemptAt: nextAttemptAt ?? this.nextAttemptAt,
      lastErrorCode: lastErrorCode ?? this.lastErrorCode,
      lastErrorMessage: lastErrorMessage ?? this.lastErrorMessage,
      createdAt: createdAt ?? this.createdAt,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (opUuid.present) {
      map['op_uuid'] = Variable<String>(opUuid.value);
    }
    if (userSub.present) {
      map['user_sub'] = Variable<String>(userSub.value);
    }
    if (companyId.present) {
      map['company_id'] = Variable<int>(companyId.value);
    }
    if (siteId.present) {
      map['site_id'] = Variable<int>(siteId.value);
    }
    if (type.present) {
      map['type'] = Variable<String>(type.value);
    }
    if (targetUuid.present) {
      map['target_uuid'] = Variable<String>(targetUuid.value);
    }
    if (payloadJson.present) {
      map['payload_json'] = Variable<String>(payloadJson.value);
    }
    if (baseRev.present) {
      map['base_rev'] = Variable<int>(baseRev.value);
    }
    if (dependsOnJson.present) {
      map['depends_on_json'] = Variable<String>(dependsOnJson.value);
    }
    if (deviceTime.present) {
      map['device_time'] = Variable<String>(deviceTime.value);
    }
    if (elapsedMs.present) {
      map['elapsed_ms'] = Variable<int>(elapsedMs.value);
    }
    if (bootId.present) {
      map['boot_id'] = Variable<String>(bootId.value);
    }
    if (offline.present) {
      map['offline'] = Variable<bool>(offline.value);
    }
    if (status.present) {
      map['status'] = Variable<String>(status.value);
    }
    if (attempts.present) {
      map['attempts'] = Variable<int>(attempts.value);
    }
    if (nextAttemptAt.present) {
      map['next_attempt_at'] = Variable<DateTime>(nextAttemptAt.value);
    }
    if (lastErrorCode.present) {
      map['last_error_code'] = Variable<String>(lastErrorCode.value);
    }
    if (lastErrorMessage.present) {
      map['last_error_message'] = Variable<String>(lastErrorMessage.value);
    }
    if (createdAt.present) {
      map['created_at'] = Variable<DateTime>(createdAt.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('OutboxCompanion(')
          ..write('opUuid: $opUuid, ')
          ..write('userSub: $userSub, ')
          ..write('companyId: $companyId, ')
          ..write('siteId: $siteId, ')
          ..write('type: $type, ')
          ..write('targetUuid: $targetUuid, ')
          ..write('payloadJson: $payloadJson, ')
          ..write('baseRev: $baseRev, ')
          ..write('dependsOnJson: $dependsOnJson, ')
          ..write('deviceTime: $deviceTime, ')
          ..write('elapsedMs: $elapsedMs, ')
          ..write('bootId: $bootId, ')
          ..write('offline: $offline, ')
          ..write('status: $status, ')
          ..write('attempts: $attempts, ')
          ..write('nextAttemptAt: $nextAttemptAt, ')
          ..write('lastErrorCode: $lastErrorCode, ')
          ..write('lastErrorMessage: $lastErrorMessage, ')
          ..write('createdAt: $createdAt, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

class $KvEntriesTable extends KvEntries
    with TableInfo<$KvEntriesTable, KvEntry> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $KvEntriesTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _keyMeta = const VerificationMeta('key');
  @override
  late final GeneratedColumn<String> key = GeneratedColumn<String>(
    'key',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _valueMeta = const VerificationMeta('value');
  @override
  late final GeneratedColumn<String> value = GeneratedColumn<String>(
    'value',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  @override
  List<GeneratedColumn> get $columns => [key, value];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'kv_entries';
  @override
  VerificationContext validateIntegrity(
    Insertable<KvEntry> instance, {
    bool isInserting = false,
  }) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('key')) {
      context.handle(
        _keyMeta,
        key.isAcceptableOrUnknown(data['key']!, _keyMeta),
      );
    } else if (isInserting) {
      context.missing(_keyMeta);
    }
    if (data.containsKey('value')) {
      context.handle(
        _valueMeta,
        value.isAcceptableOrUnknown(data['value']!, _valueMeta),
      );
    } else if (isInserting) {
      context.missing(_valueMeta);
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {key};
  @override
  KvEntry map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return KvEntry(
      key: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}key'],
      )!,
      value: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}value'],
      )!,
    );
  }

  @override
  $KvEntriesTable createAlias(String alias) {
    return $KvEntriesTable(attachedDatabase, alias);
  }
}

class KvEntry extends DataClass implements Insertable<KvEntry> {
  final String key;
  final String value;
  const KvEntry({required this.key, required this.value});
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['key'] = Variable<String>(key);
    map['value'] = Variable<String>(value);
    return map;
  }

  KvEntriesCompanion toCompanion(bool nullToAbsent) {
    return KvEntriesCompanion(key: Value(key), value: Value(value));
  }

  factory KvEntry.fromJson(
    Map<String, dynamic> json, {
    ValueSerializer? serializer,
  }) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return KvEntry(
      key: serializer.fromJson<String>(json['key']),
      value: serializer.fromJson<String>(json['value']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'key': serializer.toJson<String>(key),
      'value': serializer.toJson<String>(value),
    };
  }

  KvEntry copyWith({String? key, String? value}) =>
      KvEntry(key: key ?? this.key, value: value ?? this.value);
  KvEntry copyWithCompanion(KvEntriesCompanion data) {
    return KvEntry(
      key: data.key.present ? data.key.value : this.key,
      value: data.value.present ? data.value.value : this.value,
    );
  }

  @override
  String toString() {
    return (StringBuffer('KvEntry(')
          ..write('key: $key, ')
          ..write('value: $value')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(key, value);
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is KvEntry && other.key == this.key && other.value == this.value);
}

class KvEntriesCompanion extends UpdateCompanion<KvEntry> {
  final Value<String> key;
  final Value<String> value;
  final Value<int> rowid;
  const KvEntriesCompanion({
    this.key = const Value.absent(),
    this.value = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  KvEntriesCompanion.insert({
    required String key,
    required String value,
    this.rowid = const Value.absent(),
  }) : key = Value(key),
       value = Value(value);
  static Insertable<KvEntry> custom({
    Expression<String>? key,
    Expression<String>? value,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (key != null) 'key': key,
      if (value != null) 'value': value,
      if (rowid != null) 'rowid': rowid,
    });
  }

  KvEntriesCompanion copyWith({
    Value<String>? key,
    Value<String>? value,
    Value<int>? rowid,
  }) {
    return KvEntriesCompanion(
      key: key ?? this.key,
      value: value ?? this.value,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (key.present) {
      map['key'] = Variable<String>(key.value);
    }
    if (value.present) {
      map['value'] = Variable<String>(value.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('KvEntriesCompanion(')
          ..write('key: $key, ')
          ..write('value: $value, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

class $LocalProgressReportsTable extends LocalProgressReports
    with TableInfo<$LocalProgressReportsTable, LocalProgressReport> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $LocalProgressReportsTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _clientUuidMeta = const VerificationMeta(
    'clientUuid',
  );
  @override
  late final GeneratedColumn<String> clientUuid = GeneratedColumn<String>(
    'client_uuid',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _userSubMeta = const VerificationMeta(
    'userSub',
  );
  @override
  late final GeneratedColumn<String> userSub = GeneratedColumn<String>(
    'user_sub',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _companyIdMeta = const VerificationMeta(
    'companyId',
  );
  @override
  late final GeneratedColumn<int> companyId = GeneratedColumn<int>(
    'company_id',
    aliasedName,
    true,
    type: DriftSqlType.int,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _projectIdMeta = const VerificationMeta(
    'projectId',
  );
  @override
  late final GeneratedColumn<int> projectId = GeneratedColumn<int>(
    'project_id',
    aliasedName,
    false,
    type: DriftSqlType.int,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _projectLabelMeta = const VerificationMeta(
    'projectLabel',
  );
  @override
  late final GeneratedColumn<String> projectLabel = GeneratedColumn<String>(
    'project_label',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
    defaultValue: const Constant(''),
  );
  static const VerificationMeta _stageIdMeta = const VerificationMeta(
    'stageId',
  );
  @override
  late final GeneratedColumn<int> stageId = GeneratedColumn<int>(
    'stage_id',
    aliasedName,
    false,
    type: DriftSqlType.int,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _stageLabelMeta = const VerificationMeta(
    'stageLabel',
  );
  @override
  late final GeneratedColumn<String> stageLabel = GeneratedColumn<String>(
    'stage_label',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
    defaultValue: const Constant(''),
  );
  static const VerificationMeta _pctBeforeMeta = const VerificationMeta(
    'pctBefore',
  );
  @override
  late final GeneratedColumn<double> pctBefore = GeneratedColumn<double>(
    'pct_before',
    aliasedName,
    true,
    type: DriftSqlType.double,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _pctAfterMeta = const VerificationMeta(
    'pctAfter',
  );
  @override
  late final GeneratedColumn<double> pctAfter = GeneratedColumn<double>(
    'pct_after',
    aliasedName,
    false,
    type: DriftSqlType.double,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _workMeta = const VerificationMeta('work');
  @override
  late final GeneratedColumn<String> work = GeneratedColumn<String>(
    'work',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
    defaultValue: const Constant(''),
  );
  static const VerificationMeta _issuesMeta = const VerificationMeta('issues');
  @override
  late final GeneratedColumn<String> issues = GeneratedColumn<String>(
    'issues',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _photoUuidsJsonMeta = const VerificationMeta(
    'photoUuidsJson',
  );
  @override
  late final GeneratedColumn<String> photoUuidsJson = GeneratedColumn<String>(
    'photo_uuids_json',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
    defaultValue: const Constant('[]'),
  );
  static const VerificationMeta _serverPhotoCountMeta = const VerificationMeta(
    'serverPhotoCount',
  );
  @override
  late final GeneratedColumn<int> serverPhotoCount = GeneratedColumn<int>(
    'server_photo_count',
    aliasedName,
    false,
    type: DriftSqlType.int,
    requiredDuringInsert: false,
    defaultValue: const Constant(0),
  );
  static const VerificationMeta _reasonMeta = const VerificationMeta('reason');
  @override
  late final GeneratedColumn<String> reason = GeneratedColumn<String>(
    'reason',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _serverIdMeta = const VerificationMeta(
    'serverId',
  );
  @override
  late final GeneratedColumn<int> serverId = GeneratedColumn<int>(
    'server_id',
    aliasedName,
    true,
    type: DriftSqlType.int,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _serverRevMeta = const VerificationMeta(
    'serverRev',
  );
  @override
  late final GeneratedColumn<int> serverRev = GeneratedColumn<int>(
    'server_rev',
    aliasedName,
    true,
    type: DriftSqlType.int,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _docNoMeta = const VerificationMeta('docNo');
  @override
  late final GeneratedColumn<String> docNo = GeneratedColumn<String>(
    'doc_no',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _editableUntilMeta = const VerificationMeta(
    'editableUntil',
  );
  @override
  late final GeneratedColumn<String> editableUntil = GeneratedColumn<String>(
    'editable_until',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _serverPctAfterMeta = const VerificationMeta(
    'serverPctAfter',
  );
  @override
  late final GeneratedColumn<double> serverPctAfter = GeneratedColumn<double>(
    'server_pct_after',
    aliasedName,
    true,
    type: DriftSqlType.double,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _syncStateMeta = const VerificationMeta(
    'syncState',
  );
  @override
  late final GeneratedColumn<String> syncState = GeneratedColumn<String>(
    'sync_state',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
    defaultValue: const Constant('local'),
  );
  static const VerificationMeta _lastErrorMeta = const VerificationMeta(
    'lastError',
  );
  @override
  late final GeneratedColumn<String> lastError = GeneratedColumn<String>(
    'last_error',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _lastErrorCodeMeta = const VerificationMeta(
    'lastErrorCode',
  );
  @override
  late final GeneratedColumn<String> lastErrorCode = GeneratedColumn<String>(
    'last_error_code',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _conflictCopyJsonMeta = const VerificationMeta(
    'conflictCopyJson',
  );
  @override
  late final GeneratedColumn<String> conflictCopyJson = GeneratedColumn<String>(
    'conflict_copy_json',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _offlineMeta = const VerificationMeta(
    'offline',
  );
  @override
  late final GeneratedColumn<bool> offline = GeneratedColumn<bool>(
    'offline',
    aliasedName,
    false,
    type: DriftSqlType.bool,
    requiredDuringInsert: false,
    defaultConstraints: GeneratedColumn.constraintIsAlways(
      'CHECK ("offline" IN (0, 1))',
    ),
    defaultValue: const Constant(false),
  );
  static const VerificationMeta _createdAtMeta = const VerificationMeta(
    'createdAt',
  );
  @override
  late final GeneratedColumn<DateTime> createdAt = GeneratedColumn<DateTime>(
    'created_at',
    aliasedName,
    false,
    type: DriftSqlType.dateTime,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _updatedAtMeta = const VerificationMeta(
    'updatedAt',
  );
  @override
  late final GeneratedColumn<DateTime> updatedAt = GeneratedColumn<DateTime>(
    'updated_at',
    aliasedName,
    false,
    type: DriftSqlType.dateTime,
    requiredDuringInsert: true,
  );
  @override
  List<GeneratedColumn> get $columns => [
    clientUuid,
    userSub,
    companyId,
    projectId,
    projectLabel,
    stageId,
    stageLabel,
    pctBefore,
    pctAfter,
    work,
    issues,
    photoUuidsJson,
    serverPhotoCount,
    reason,
    serverId,
    serverRev,
    docNo,
    editableUntil,
    serverPctAfter,
    syncState,
    lastError,
    lastErrorCode,
    conflictCopyJson,
    offline,
    createdAt,
    updatedAt,
  ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'local_progress_reports';
  @override
  VerificationContext validateIntegrity(
    Insertable<LocalProgressReport> instance, {
    bool isInserting = false,
  }) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('client_uuid')) {
      context.handle(
        _clientUuidMeta,
        clientUuid.isAcceptableOrUnknown(data['client_uuid']!, _clientUuidMeta),
      );
    } else if (isInserting) {
      context.missing(_clientUuidMeta);
    }
    if (data.containsKey('user_sub')) {
      context.handle(
        _userSubMeta,
        userSub.isAcceptableOrUnknown(data['user_sub']!, _userSubMeta),
      );
    } else if (isInserting) {
      context.missing(_userSubMeta);
    }
    if (data.containsKey('company_id')) {
      context.handle(
        _companyIdMeta,
        companyId.isAcceptableOrUnknown(data['company_id']!, _companyIdMeta),
      );
    }
    if (data.containsKey('project_id')) {
      context.handle(
        _projectIdMeta,
        projectId.isAcceptableOrUnknown(data['project_id']!, _projectIdMeta),
      );
    } else if (isInserting) {
      context.missing(_projectIdMeta);
    }
    if (data.containsKey('project_label')) {
      context.handle(
        _projectLabelMeta,
        projectLabel.isAcceptableOrUnknown(
          data['project_label']!,
          _projectLabelMeta,
        ),
      );
    }
    if (data.containsKey('stage_id')) {
      context.handle(
        _stageIdMeta,
        stageId.isAcceptableOrUnknown(data['stage_id']!, _stageIdMeta),
      );
    } else if (isInserting) {
      context.missing(_stageIdMeta);
    }
    if (data.containsKey('stage_label')) {
      context.handle(
        _stageLabelMeta,
        stageLabel.isAcceptableOrUnknown(data['stage_label']!, _stageLabelMeta),
      );
    }
    if (data.containsKey('pct_before')) {
      context.handle(
        _pctBeforeMeta,
        pctBefore.isAcceptableOrUnknown(data['pct_before']!, _pctBeforeMeta),
      );
    }
    if (data.containsKey('pct_after')) {
      context.handle(
        _pctAfterMeta,
        pctAfter.isAcceptableOrUnknown(data['pct_after']!, _pctAfterMeta),
      );
    } else if (isInserting) {
      context.missing(_pctAfterMeta);
    }
    if (data.containsKey('work')) {
      context.handle(
        _workMeta,
        work.isAcceptableOrUnknown(data['work']!, _workMeta),
      );
    }
    if (data.containsKey('issues')) {
      context.handle(
        _issuesMeta,
        issues.isAcceptableOrUnknown(data['issues']!, _issuesMeta),
      );
    }
    if (data.containsKey('photo_uuids_json')) {
      context.handle(
        _photoUuidsJsonMeta,
        photoUuidsJson.isAcceptableOrUnknown(
          data['photo_uuids_json']!,
          _photoUuidsJsonMeta,
        ),
      );
    }
    if (data.containsKey('server_photo_count')) {
      context.handle(
        _serverPhotoCountMeta,
        serverPhotoCount.isAcceptableOrUnknown(
          data['server_photo_count']!,
          _serverPhotoCountMeta,
        ),
      );
    }
    if (data.containsKey('reason')) {
      context.handle(
        _reasonMeta,
        reason.isAcceptableOrUnknown(data['reason']!, _reasonMeta),
      );
    }
    if (data.containsKey('server_id')) {
      context.handle(
        _serverIdMeta,
        serverId.isAcceptableOrUnknown(data['server_id']!, _serverIdMeta),
      );
    }
    if (data.containsKey('server_rev')) {
      context.handle(
        _serverRevMeta,
        serverRev.isAcceptableOrUnknown(data['server_rev']!, _serverRevMeta),
      );
    }
    if (data.containsKey('doc_no')) {
      context.handle(
        _docNoMeta,
        docNo.isAcceptableOrUnknown(data['doc_no']!, _docNoMeta),
      );
    }
    if (data.containsKey('editable_until')) {
      context.handle(
        _editableUntilMeta,
        editableUntil.isAcceptableOrUnknown(
          data['editable_until']!,
          _editableUntilMeta,
        ),
      );
    }
    if (data.containsKey('server_pct_after')) {
      context.handle(
        _serverPctAfterMeta,
        serverPctAfter.isAcceptableOrUnknown(
          data['server_pct_after']!,
          _serverPctAfterMeta,
        ),
      );
    }
    if (data.containsKey('sync_state')) {
      context.handle(
        _syncStateMeta,
        syncState.isAcceptableOrUnknown(data['sync_state']!, _syncStateMeta),
      );
    }
    if (data.containsKey('last_error')) {
      context.handle(
        _lastErrorMeta,
        lastError.isAcceptableOrUnknown(data['last_error']!, _lastErrorMeta),
      );
    }
    if (data.containsKey('last_error_code')) {
      context.handle(
        _lastErrorCodeMeta,
        lastErrorCode.isAcceptableOrUnknown(
          data['last_error_code']!,
          _lastErrorCodeMeta,
        ),
      );
    }
    if (data.containsKey('conflict_copy_json')) {
      context.handle(
        _conflictCopyJsonMeta,
        conflictCopyJson.isAcceptableOrUnknown(
          data['conflict_copy_json']!,
          _conflictCopyJsonMeta,
        ),
      );
    }
    if (data.containsKey('offline')) {
      context.handle(
        _offlineMeta,
        offline.isAcceptableOrUnknown(data['offline']!, _offlineMeta),
      );
    }
    if (data.containsKey('created_at')) {
      context.handle(
        _createdAtMeta,
        createdAt.isAcceptableOrUnknown(data['created_at']!, _createdAtMeta),
      );
    } else if (isInserting) {
      context.missing(_createdAtMeta);
    }
    if (data.containsKey('updated_at')) {
      context.handle(
        _updatedAtMeta,
        updatedAt.isAcceptableOrUnknown(data['updated_at']!, _updatedAtMeta),
      );
    } else if (isInserting) {
      context.missing(_updatedAtMeta);
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {clientUuid};
  @override
  LocalProgressReport map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return LocalProgressReport(
      clientUuid: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}client_uuid'],
      )!,
      userSub: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}user_sub'],
      )!,
      companyId: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}company_id'],
      ),
      projectId: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}project_id'],
      )!,
      projectLabel: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}project_label'],
      )!,
      stageId: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}stage_id'],
      )!,
      stageLabel: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}stage_label'],
      )!,
      pctBefore: attachedDatabase.typeMapping.read(
        DriftSqlType.double,
        data['${effectivePrefix}pct_before'],
      ),
      pctAfter: attachedDatabase.typeMapping.read(
        DriftSqlType.double,
        data['${effectivePrefix}pct_after'],
      )!,
      work: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}work'],
      )!,
      issues: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}issues'],
      ),
      photoUuidsJson: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}photo_uuids_json'],
      )!,
      serverPhotoCount: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}server_photo_count'],
      )!,
      reason: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}reason'],
      ),
      serverId: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}server_id'],
      ),
      serverRev: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}server_rev'],
      ),
      docNo: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}doc_no'],
      ),
      editableUntil: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}editable_until'],
      ),
      serverPctAfter: attachedDatabase.typeMapping.read(
        DriftSqlType.double,
        data['${effectivePrefix}server_pct_after'],
      ),
      syncState: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}sync_state'],
      )!,
      lastError: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}last_error'],
      ),
      lastErrorCode: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}last_error_code'],
      ),
      conflictCopyJson: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}conflict_copy_json'],
      ),
      offline: attachedDatabase.typeMapping.read(
        DriftSqlType.bool,
        data['${effectivePrefix}offline'],
      )!,
      createdAt: attachedDatabase.typeMapping.read(
        DriftSqlType.dateTime,
        data['${effectivePrefix}created_at'],
      )!,
      updatedAt: attachedDatabase.typeMapping.read(
        DriftSqlType.dateTime,
        data['${effectivePrefix}updated_at'],
      )!,
    );
  }

  @override
  $LocalProgressReportsTable createAlias(String alias) {
    return $LocalProgressReportsTable(attachedDatabase, alias);
  }
}

class LocalProgressReport extends DataClass
    implements Insertable<LocalProgressReport> {
  final String clientUuid;
  final String userSub;

  /// MC3 (schema v3): PT of the report (= PT of its project). Null = written before v3, not yet assigned.
  final int? companyId;
  final int projectId;
  final String projectLabel;
  final int stageId;
  final String stageLabel;

  /// Stage % known when the report was written (client guard: pctAfter ≥ pctBefore).
  final double? pctBefore;
  final double pctAfter;
  final String work;
  final String? issues;

  /// Local photo ids (media_blobs, kind `progress`) not yet on the server.
  final String photoUuidsJson;

  /// Photos already on the server report (edit: total ≤ 5).
  final int serverPhotoCount;

  /// Edit reason (required once the server knows the report).
  final String? reason;
  final int? serverId;
  final int? serverRev;
  final String? docNo;
  final String? editableUntil;

  /// Server pct_after of the report at the time the edit started (pct_after is only sent when changed).
  final double? serverPctAfter;

  /// local | queued | synced | conflict | rejected
  final String syncState;
  final String? lastError;
  final String? lastErrorCode;

  /// `server_report` of a conflict / NOT_EDITABLE (server wins; the local version is kept beside it).
  final String? conflictCopyJson;
  final bool offline;
  final DateTime createdAt;
  final DateTime updatedAt;
  const LocalProgressReport({
    required this.clientUuid,
    required this.userSub,
    this.companyId,
    required this.projectId,
    required this.projectLabel,
    required this.stageId,
    required this.stageLabel,
    this.pctBefore,
    required this.pctAfter,
    required this.work,
    this.issues,
    required this.photoUuidsJson,
    required this.serverPhotoCount,
    this.reason,
    this.serverId,
    this.serverRev,
    this.docNo,
    this.editableUntil,
    this.serverPctAfter,
    required this.syncState,
    this.lastError,
    this.lastErrorCode,
    this.conflictCopyJson,
    required this.offline,
    required this.createdAt,
    required this.updatedAt,
  });
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['client_uuid'] = Variable<String>(clientUuid);
    map['user_sub'] = Variable<String>(userSub);
    if (!nullToAbsent || companyId != null) {
      map['company_id'] = Variable<int>(companyId);
    }
    map['project_id'] = Variable<int>(projectId);
    map['project_label'] = Variable<String>(projectLabel);
    map['stage_id'] = Variable<int>(stageId);
    map['stage_label'] = Variable<String>(stageLabel);
    if (!nullToAbsent || pctBefore != null) {
      map['pct_before'] = Variable<double>(pctBefore);
    }
    map['pct_after'] = Variable<double>(pctAfter);
    map['work'] = Variable<String>(work);
    if (!nullToAbsent || issues != null) {
      map['issues'] = Variable<String>(issues);
    }
    map['photo_uuids_json'] = Variable<String>(photoUuidsJson);
    map['server_photo_count'] = Variable<int>(serverPhotoCount);
    if (!nullToAbsent || reason != null) {
      map['reason'] = Variable<String>(reason);
    }
    if (!nullToAbsent || serverId != null) {
      map['server_id'] = Variable<int>(serverId);
    }
    if (!nullToAbsent || serverRev != null) {
      map['server_rev'] = Variable<int>(serverRev);
    }
    if (!nullToAbsent || docNo != null) {
      map['doc_no'] = Variable<String>(docNo);
    }
    if (!nullToAbsent || editableUntil != null) {
      map['editable_until'] = Variable<String>(editableUntil);
    }
    if (!nullToAbsent || serverPctAfter != null) {
      map['server_pct_after'] = Variable<double>(serverPctAfter);
    }
    map['sync_state'] = Variable<String>(syncState);
    if (!nullToAbsent || lastError != null) {
      map['last_error'] = Variable<String>(lastError);
    }
    if (!nullToAbsent || lastErrorCode != null) {
      map['last_error_code'] = Variable<String>(lastErrorCode);
    }
    if (!nullToAbsent || conflictCopyJson != null) {
      map['conflict_copy_json'] = Variable<String>(conflictCopyJson);
    }
    map['offline'] = Variable<bool>(offline);
    map['created_at'] = Variable<DateTime>(createdAt);
    map['updated_at'] = Variable<DateTime>(updatedAt);
    return map;
  }

  LocalProgressReportsCompanion toCompanion(bool nullToAbsent) {
    return LocalProgressReportsCompanion(
      clientUuid: Value(clientUuid),
      userSub: Value(userSub),
      companyId: companyId == null && nullToAbsent
          ? const Value.absent()
          : Value(companyId),
      projectId: Value(projectId),
      projectLabel: Value(projectLabel),
      stageId: Value(stageId),
      stageLabel: Value(stageLabel),
      pctBefore: pctBefore == null && nullToAbsent
          ? const Value.absent()
          : Value(pctBefore),
      pctAfter: Value(pctAfter),
      work: Value(work),
      issues: issues == null && nullToAbsent
          ? const Value.absent()
          : Value(issues),
      photoUuidsJson: Value(photoUuidsJson),
      serverPhotoCount: Value(serverPhotoCount),
      reason: reason == null && nullToAbsent
          ? const Value.absent()
          : Value(reason),
      serverId: serverId == null && nullToAbsent
          ? const Value.absent()
          : Value(serverId),
      serverRev: serverRev == null && nullToAbsent
          ? const Value.absent()
          : Value(serverRev),
      docNo: docNo == null && nullToAbsent
          ? const Value.absent()
          : Value(docNo),
      editableUntil: editableUntil == null && nullToAbsent
          ? const Value.absent()
          : Value(editableUntil),
      serverPctAfter: serverPctAfter == null && nullToAbsent
          ? const Value.absent()
          : Value(serverPctAfter),
      syncState: Value(syncState),
      lastError: lastError == null && nullToAbsent
          ? const Value.absent()
          : Value(lastError),
      lastErrorCode: lastErrorCode == null && nullToAbsent
          ? const Value.absent()
          : Value(lastErrorCode),
      conflictCopyJson: conflictCopyJson == null && nullToAbsent
          ? const Value.absent()
          : Value(conflictCopyJson),
      offline: Value(offline),
      createdAt: Value(createdAt),
      updatedAt: Value(updatedAt),
    );
  }

  factory LocalProgressReport.fromJson(
    Map<String, dynamic> json, {
    ValueSerializer? serializer,
  }) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return LocalProgressReport(
      clientUuid: serializer.fromJson<String>(json['clientUuid']),
      userSub: serializer.fromJson<String>(json['userSub']),
      companyId: serializer.fromJson<int?>(json['companyId']),
      projectId: serializer.fromJson<int>(json['projectId']),
      projectLabel: serializer.fromJson<String>(json['projectLabel']),
      stageId: serializer.fromJson<int>(json['stageId']),
      stageLabel: serializer.fromJson<String>(json['stageLabel']),
      pctBefore: serializer.fromJson<double?>(json['pctBefore']),
      pctAfter: serializer.fromJson<double>(json['pctAfter']),
      work: serializer.fromJson<String>(json['work']),
      issues: serializer.fromJson<String?>(json['issues']),
      photoUuidsJson: serializer.fromJson<String>(json['photoUuidsJson']),
      serverPhotoCount: serializer.fromJson<int>(json['serverPhotoCount']),
      reason: serializer.fromJson<String?>(json['reason']),
      serverId: serializer.fromJson<int?>(json['serverId']),
      serverRev: serializer.fromJson<int?>(json['serverRev']),
      docNo: serializer.fromJson<String?>(json['docNo']),
      editableUntil: serializer.fromJson<String?>(json['editableUntil']),
      serverPctAfter: serializer.fromJson<double?>(json['serverPctAfter']),
      syncState: serializer.fromJson<String>(json['syncState']),
      lastError: serializer.fromJson<String?>(json['lastError']),
      lastErrorCode: serializer.fromJson<String?>(json['lastErrorCode']),
      conflictCopyJson: serializer.fromJson<String?>(json['conflictCopyJson']),
      offline: serializer.fromJson<bool>(json['offline']),
      createdAt: serializer.fromJson<DateTime>(json['createdAt']),
      updatedAt: serializer.fromJson<DateTime>(json['updatedAt']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'clientUuid': serializer.toJson<String>(clientUuid),
      'userSub': serializer.toJson<String>(userSub),
      'companyId': serializer.toJson<int?>(companyId),
      'projectId': serializer.toJson<int>(projectId),
      'projectLabel': serializer.toJson<String>(projectLabel),
      'stageId': serializer.toJson<int>(stageId),
      'stageLabel': serializer.toJson<String>(stageLabel),
      'pctBefore': serializer.toJson<double?>(pctBefore),
      'pctAfter': serializer.toJson<double>(pctAfter),
      'work': serializer.toJson<String>(work),
      'issues': serializer.toJson<String?>(issues),
      'photoUuidsJson': serializer.toJson<String>(photoUuidsJson),
      'serverPhotoCount': serializer.toJson<int>(serverPhotoCount),
      'reason': serializer.toJson<String?>(reason),
      'serverId': serializer.toJson<int?>(serverId),
      'serverRev': serializer.toJson<int?>(serverRev),
      'docNo': serializer.toJson<String?>(docNo),
      'editableUntil': serializer.toJson<String?>(editableUntil),
      'serverPctAfter': serializer.toJson<double?>(serverPctAfter),
      'syncState': serializer.toJson<String>(syncState),
      'lastError': serializer.toJson<String?>(lastError),
      'lastErrorCode': serializer.toJson<String?>(lastErrorCode),
      'conflictCopyJson': serializer.toJson<String?>(conflictCopyJson),
      'offline': serializer.toJson<bool>(offline),
      'createdAt': serializer.toJson<DateTime>(createdAt),
      'updatedAt': serializer.toJson<DateTime>(updatedAt),
    };
  }

  LocalProgressReport copyWith({
    String? clientUuid,
    String? userSub,
    Value<int?> companyId = const Value.absent(),
    int? projectId,
    String? projectLabel,
    int? stageId,
    String? stageLabel,
    Value<double?> pctBefore = const Value.absent(),
    double? pctAfter,
    String? work,
    Value<String?> issues = const Value.absent(),
    String? photoUuidsJson,
    int? serverPhotoCount,
    Value<String?> reason = const Value.absent(),
    Value<int?> serverId = const Value.absent(),
    Value<int?> serverRev = const Value.absent(),
    Value<String?> docNo = const Value.absent(),
    Value<String?> editableUntil = const Value.absent(),
    Value<double?> serverPctAfter = const Value.absent(),
    String? syncState,
    Value<String?> lastError = const Value.absent(),
    Value<String?> lastErrorCode = const Value.absent(),
    Value<String?> conflictCopyJson = const Value.absent(),
    bool? offline,
    DateTime? createdAt,
    DateTime? updatedAt,
  }) => LocalProgressReport(
    clientUuid: clientUuid ?? this.clientUuid,
    userSub: userSub ?? this.userSub,
    companyId: companyId.present ? companyId.value : this.companyId,
    projectId: projectId ?? this.projectId,
    projectLabel: projectLabel ?? this.projectLabel,
    stageId: stageId ?? this.stageId,
    stageLabel: stageLabel ?? this.stageLabel,
    pctBefore: pctBefore.present ? pctBefore.value : this.pctBefore,
    pctAfter: pctAfter ?? this.pctAfter,
    work: work ?? this.work,
    issues: issues.present ? issues.value : this.issues,
    photoUuidsJson: photoUuidsJson ?? this.photoUuidsJson,
    serverPhotoCount: serverPhotoCount ?? this.serverPhotoCount,
    reason: reason.present ? reason.value : this.reason,
    serverId: serverId.present ? serverId.value : this.serverId,
    serverRev: serverRev.present ? serverRev.value : this.serverRev,
    docNo: docNo.present ? docNo.value : this.docNo,
    editableUntil: editableUntil.present
        ? editableUntil.value
        : this.editableUntil,
    serverPctAfter: serverPctAfter.present
        ? serverPctAfter.value
        : this.serverPctAfter,
    syncState: syncState ?? this.syncState,
    lastError: lastError.present ? lastError.value : this.lastError,
    lastErrorCode: lastErrorCode.present
        ? lastErrorCode.value
        : this.lastErrorCode,
    conflictCopyJson: conflictCopyJson.present
        ? conflictCopyJson.value
        : this.conflictCopyJson,
    offline: offline ?? this.offline,
    createdAt: createdAt ?? this.createdAt,
    updatedAt: updatedAt ?? this.updatedAt,
  );
  LocalProgressReport copyWithCompanion(LocalProgressReportsCompanion data) {
    return LocalProgressReport(
      clientUuid: data.clientUuid.present
          ? data.clientUuid.value
          : this.clientUuid,
      userSub: data.userSub.present ? data.userSub.value : this.userSub,
      companyId: data.companyId.present ? data.companyId.value : this.companyId,
      projectId: data.projectId.present ? data.projectId.value : this.projectId,
      projectLabel: data.projectLabel.present
          ? data.projectLabel.value
          : this.projectLabel,
      stageId: data.stageId.present ? data.stageId.value : this.stageId,
      stageLabel: data.stageLabel.present
          ? data.stageLabel.value
          : this.stageLabel,
      pctBefore: data.pctBefore.present ? data.pctBefore.value : this.pctBefore,
      pctAfter: data.pctAfter.present ? data.pctAfter.value : this.pctAfter,
      work: data.work.present ? data.work.value : this.work,
      issues: data.issues.present ? data.issues.value : this.issues,
      photoUuidsJson: data.photoUuidsJson.present
          ? data.photoUuidsJson.value
          : this.photoUuidsJson,
      serverPhotoCount: data.serverPhotoCount.present
          ? data.serverPhotoCount.value
          : this.serverPhotoCount,
      reason: data.reason.present ? data.reason.value : this.reason,
      serverId: data.serverId.present ? data.serverId.value : this.serverId,
      serverRev: data.serverRev.present ? data.serverRev.value : this.serverRev,
      docNo: data.docNo.present ? data.docNo.value : this.docNo,
      editableUntil: data.editableUntil.present
          ? data.editableUntil.value
          : this.editableUntil,
      serverPctAfter: data.serverPctAfter.present
          ? data.serverPctAfter.value
          : this.serverPctAfter,
      syncState: data.syncState.present ? data.syncState.value : this.syncState,
      lastError: data.lastError.present ? data.lastError.value : this.lastError,
      lastErrorCode: data.lastErrorCode.present
          ? data.lastErrorCode.value
          : this.lastErrorCode,
      conflictCopyJson: data.conflictCopyJson.present
          ? data.conflictCopyJson.value
          : this.conflictCopyJson,
      offline: data.offline.present ? data.offline.value : this.offline,
      createdAt: data.createdAt.present ? data.createdAt.value : this.createdAt,
      updatedAt: data.updatedAt.present ? data.updatedAt.value : this.updatedAt,
    );
  }

  @override
  String toString() {
    return (StringBuffer('LocalProgressReport(')
          ..write('clientUuid: $clientUuid, ')
          ..write('userSub: $userSub, ')
          ..write('companyId: $companyId, ')
          ..write('projectId: $projectId, ')
          ..write('projectLabel: $projectLabel, ')
          ..write('stageId: $stageId, ')
          ..write('stageLabel: $stageLabel, ')
          ..write('pctBefore: $pctBefore, ')
          ..write('pctAfter: $pctAfter, ')
          ..write('work: $work, ')
          ..write('issues: $issues, ')
          ..write('photoUuidsJson: $photoUuidsJson, ')
          ..write('serverPhotoCount: $serverPhotoCount, ')
          ..write('reason: $reason, ')
          ..write('serverId: $serverId, ')
          ..write('serverRev: $serverRev, ')
          ..write('docNo: $docNo, ')
          ..write('editableUntil: $editableUntil, ')
          ..write('serverPctAfter: $serverPctAfter, ')
          ..write('syncState: $syncState, ')
          ..write('lastError: $lastError, ')
          ..write('lastErrorCode: $lastErrorCode, ')
          ..write('conflictCopyJson: $conflictCopyJson, ')
          ..write('offline: $offline, ')
          ..write('createdAt: $createdAt, ')
          ..write('updatedAt: $updatedAt')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hashAll([
    clientUuid,
    userSub,
    companyId,
    projectId,
    projectLabel,
    stageId,
    stageLabel,
    pctBefore,
    pctAfter,
    work,
    issues,
    photoUuidsJson,
    serverPhotoCount,
    reason,
    serverId,
    serverRev,
    docNo,
    editableUntil,
    serverPctAfter,
    syncState,
    lastError,
    lastErrorCode,
    conflictCopyJson,
    offline,
    createdAt,
    updatedAt,
  ]);
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is LocalProgressReport &&
          other.clientUuid == this.clientUuid &&
          other.userSub == this.userSub &&
          other.companyId == this.companyId &&
          other.projectId == this.projectId &&
          other.projectLabel == this.projectLabel &&
          other.stageId == this.stageId &&
          other.stageLabel == this.stageLabel &&
          other.pctBefore == this.pctBefore &&
          other.pctAfter == this.pctAfter &&
          other.work == this.work &&
          other.issues == this.issues &&
          other.photoUuidsJson == this.photoUuidsJson &&
          other.serverPhotoCount == this.serverPhotoCount &&
          other.reason == this.reason &&
          other.serverId == this.serverId &&
          other.serverRev == this.serverRev &&
          other.docNo == this.docNo &&
          other.editableUntil == this.editableUntil &&
          other.serverPctAfter == this.serverPctAfter &&
          other.syncState == this.syncState &&
          other.lastError == this.lastError &&
          other.lastErrorCode == this.lastErrorCode &&
          other.conflictCopyJson == this.conflictCopyJson &&
          other.offline == this.offline &&
          other.createdAt == this.createdAt &&
          other.updatedAt == this.updatedAt);
}

class LocalProgressReportsCompanion
    extends UpdateCompanion<LocalProgressReport> {
  final Value<String> clientUuid;
  final Value<String> userSub;
  final Value<int?> companyId;
  final Value<int> projectId;
  final Value<String> projectLabel;
  final Value<int> stageId;
  final Value<String> stageLabel;
  final Value<double?> pctBefore;
  final Value<double> pctAfter;
  final Value<String> work;
  final Value<String?> issues;
  final Value<String> photoUuidsJson;
  final Value<int> serverPhotoCount;
  final Value<String?> reason;
  final Value<int?> serverId;
  final Value<int?> serverRev;
  final Value<String?> docNo;
  final Value<String?> editableUntil;
  final Value<double?> serverPctAfter;
  final Value<String> syncState;
  final Value<String?> lastError;
  final Value<String?> lastErrorCode;
  final Value<String?> conflictCopyJson;
  final Value<bool> offline;
  final Value<DateTime> createdAt;
  final Value<DateTime> updatedAt;
  final Value<int> rowid;
  const LocalProgressReportsCompanion({
    this.clientUuid = const Value.absent(),
    this.userSub = const Value.absent(),
    this.companyId = const Value.absent(),
    this.projectId = const Value.absent(),
    this.projectLabel = const Value.absent(),
    this.stageId = const Value.absent(),
    this.stageLabel = const Value.absent(),
    this.pctBefore = const Value.absent(),
    this.pctAfter = const Value.absent(),
    this.work = const Value.absent(),
    this.issues = const Value.absent(),
    this.photoUuidsJson = const Value.absent(),
    this.serverPhotoCount = const Value.absent(),
    this.reason = const Value.absent(),
    this.serverId = const Value.absent(),
    this.serverRev = const Value.absent(),
    this.docNo = const Value.absent(),
    this.editableUntil = const Value.absent(),
    this.serverPctAfter = const Value.absent(),
    this.syncState = const Value.absent(),
    this.lastError = const Value.absent(),
    this.lastErrorCode = const Value.absent(),
    this.conflictCopyJson = const Value.absent(),
    this.offline = const Value.absent(),
    this.createdAt = const Value.absent(),
    this.updatedAt = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  LocalProgressReportsCompanion.insert({
    required String clientUuid,
    required String userSub,
    this.companyId = const Value.absent(),
    required int projectId,
    this.projectLabel = const Value.absent(),
    required int stageId,
    this.stageLabel = const Value.absent(),
    this.pctBefore = const Value.absent(),
    required double pctAfter,
    this.work = const Value.absent(),
    this.issues = const Value.absent(),
    this.photoUuidsJson = const Value.absent(),
    this.serverPhotoCount = const Value.absent(),
    this.reason = const Value.absent(),
    this.serverId = const Value.absent(),
    this.serverRev = const Value.absent(),
    this.docNo = const Value.absent(),
    this.editableUntil = const Value.absent(),
    this.serverPctAfter = const Value.absent(),
    this.syncState = const Value.absent(),
    this.lastError = const Value.absent(),
    this.lastErrorCode = const Value.absent(),
    this.conflictCopyJson = const Value.absent(),
    this.offline = const Value.absent(),
    required DateTime createdAt,
    required DateTime updatedAt,
    this.rowid = const Value.absent(),
  }) : clientUuid = Value(clientUuid),
       userSub = Value(userSub),
       projectId = Value(projectId),
       stageId = Value(stageId),
       pctAfter = Value(pctAfter),
       createdAt = Value(createdAt),
       updatedAt = Value(updatedAt);
  static Insertable<LocalProgressReport> custom({
    Expression<String>? clientUuid,
    Expression<String>? userSub,
    Expression<int>? companyId,
    Expression<int>? projectId,
    Expression<String>? projectLabel,
    Expression<int>? stageId,
    Expression<String>? stageLabel,
    Expression<double>? pctBefore,
    Expression<double>? pctAfter,
    Expression<String>? work,
    Expression<String>? issues,
    Expression<String>? photoUuidsJson,
    Expression<int>? serverPhotoCount,
    Expression<String>? reason,
    Expression<int>? serverId,
    Expression<int>? serverRev,
    Expression<String>? docNo,
    Expression<String>? editableUntil,
    Expression<double>? serverPctAfter,
    Expression<String>? syncState,
    Expression<String>? lastError,
    Expression<String>? lastErrorCode,
    Expression<String>? conflictCopyJson,
    Expression<bool>? offline,
    Expression<DateTime>? createdAt,
    Expression<DateTime>? updatedAt,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (clientUuid != null) 'client_uuid': clientUuid,
      if (userSub != null) 'user_sub': userSub,
      if (companyId != null) 'company_id': companyId,
      if (projectId != null) 'project_id': projectId,
      if (projectLabel != null) 'project_label': projectLabel,
      if (stageId != null) 'stage_id': stageId,
      if (stageLabel != null) 'stage_label': stageLabel,
      if (pctBefore != null) 'pct_before': pctBefore,
      if (pctAfter != null) 'pct_after': pctAfter,
      if (work != null) 'work': work,
      if (issues != null) 'issues': issues,
      if (photoUuidsJson != null) 'photo_uuids_json': photoUuidsJson,
      if (serverPhotoCount != null) 'server_photo_count': serverPhotoCount,
      if (reason != null) 'reason': reason,
      if (serverId != null) 'server_id': serverId,
      if (serverRev != null) 'server_rev': serverRev,
      if (docNo != null) 'doc_no': docNo,
      if (editableUntil != null) 'editable_until': editableUntil,
      if (serverPctAfter != null) 'server_pct_after': serverPctAfter,
      if (syncState != null) 'sync_state': syncState,
      if (lastError != null) 'last_error': lastError,
      if (lastErrorCode != null) 'last_error_code': lastErrorCode,
      if (conflictCopyJson != null) 'conflict_copy_json': conflictCopyJson,
      if (offline != null) 'offline': offline,
      if (createdAt != null) 'created_at': createdAt,
      if (updatedAt != null) 'updated_at': updatedAt,
      if (rowid != null) 'rowid': rowid,
    });
  }

  LocalProgressReportsCompanion copyWith({
    Value<String>? clientUuid,
    Value<String>? userSub,
    Value<int?>? companyId,
    Value<int>? projectId,
    Value<String>? projectLabel,
    Value<int>? stageId,
    Value<String>? stageLabel,
    Value<double?>? pctBefore,
    Value<double>? pctAfter,
    Value<String>? work,
    Value<String?>? issues,
    Value<String>? photoUuidsJson,
    Value<int>? serverPhotoCount,
    Value<String?>? reason,
    Value<int?>? serverId,
    Value<int?>? serverRev,
    Value<String?>? docNo,
    Value<String?>? editableUntil,
    Value<double?>? serverPctAfter,
    Value<String>? syncState,
    Value<String?>? lastError,
    Value<String?>? lastErrorCode,
    Value<String?>? conflictCopyJson,
    Value<bool>? offline,
    Value<DateTime>? createdAt,
    Value<DateTime>? updatedAt,
    Value<int>? rowid,
  }) {
    return LocalProgressReportsCompanion(
      clientUuid: clientUuid ?? this.clientUuid,
      userSub: userSub ?? this.userSub,
      companyId: companyId ?? this.companyId,
      projectId: projectId ?? this.projectId,
      projectLabel: projectLabel ?? this.projectLabel,
      stageId: stageId ?? this.stageId,
      stageLabel: stageLabel ?? this.stageLabel,
      pctBefore: pctBefore ?? this.pctBefore,
      pctAfter: pctAfter ?? this.pctAfter,
      work: work ?? this.work,
      issues: issues ?? this.issues,
      photoUuidsJson: photoUuidsJson ?? this.photoUuidsJson,
      serverPhotoCount: serverPhotoCount ?? this.serverPhotoCount,
      reason: reason ?? this.reason,
      serverId: serverId ?? this.serverId,
      serverRev: serverRev ?? this.serverRev,
      docNo: docNo ?? this.docNo,
      editableUntil: editableUntil ?? this.editableUntil,
      serverPctAfter: serverPctAfter ?? this.serverPctAfter,
      syncState: syncState ?? this.syncState,
      lastError: lastError ?? this.lastError,
      lastErrorCode: lastErrorCode ?? this.lastErrorCode,
      conflictCopyJson: conflictCopyJson ?? this.conflictCopyJson,
      offline: offline ?? this.offline,
      createdAt: createdAt ?? this.createdAt,
      updatedAt: updatedAt ?? this.updatedAt,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (clientUuid.present) {
      map['client_uuid'] = Variable<String>(clientUuid.value);
    }
    if (userSub.present) {
      map['user_sub'] = Variable<String>(userSub.value);
    }
    if (companyId.present) {
      map['company_id'] = Variable<int>(companyId.value);
    }
    if (projectId.present) {
      map['project_id'] = Variable<int>(projectId.value);
    }
    if (projectLabel.present) {
      map['project_label'] = Variable<String>(projectLabel.value);
    }
    if (stageId.present) {
      map['stage_id'] = Variable<int>(stageId.value);
    }
    if (stageLabel.present) {
      map['stage_label'] = Variable<String>(stageLabel.value);
    }
    if (pctBefore.present) {
      map['pct_before'] = Variable<double>(pctBefore.value);
    }
    if (pctAfter.present) {
      map['pct_after'] = Variable<double>(pctAfter.value);
    }
    if (work.present) {
      map['work'] = Variable<String>(work.value);
    }
    if (issues.present) {
      map['issues'] = Variable<String>(issues.value);
    }
    if (photoUuidsJson.present) {
      map['photo_uuids_json'] = Variable<String>(photoUuidsJson.value);
    }
    if (serverPhotoCount.present) {
      map['server_photo_count'] = Variable<int>(serverPhotoCount.value);
    }
    if (reason.present) {
      map['reason'] = Variable<String>(reason.value);
    }
    if (serverId.present) {
      map['server_id'] = Variable<int>(serverId.value);
    }
    if (serverRev.present) {
      map['server_rev'] = Variable<int>(serverRev.value);
    }
    if (docNo.present) {
      map['doc_no'] = Variable<String>(docNo.value);
    }
    if (editableUntil.present) {
      map['editable_until'] = Variable<String>(editableUntil.value);
    }
    if (serverPctAfter.present) {
      map['server_pct_after'] = Variable<double>(serverPctAfter.value);
    }
    if (syncState.present) {
      map['sync_state'] = Variable<String>(syncState.value);
    }
    if (lastError.present) {
      map['last_error'] = Variable<String>(lastError.value);
    }
    if (lastErrorCode.present) {
      map['last_error_code'] = Variable<String>(lastErrorCode.value);
    }
    if (conflictCopyJson.present) {
      map['conflict_copy_json'] = Variable<String>(conflictCopyJson.value);
    }
    if (offline.present) {
      map['offline'] = Variable<bool>(offline.value);
    }
    if (createdAt.present) {
      map['created_at'] = Variable<DateTime>(createdAt.value);
    }
    if (updatedAt.present) {
      map['updated_at'] = Variable<DateTime>(updatedAt.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('LocalProgressReportsCompanion(')
          ..write('clientUuid: $clientUuid, ')
          ..write('userSub: $userSub, ')
          ..write('companyId: $companyId, ')
          ..write('projectId: $projectId, ')
          ..write('projectLabel: $projectLabel, ')
          ..write('stageId: $stageId, ')
          ..write('stageLabel: $stageLabel, ')
          ..write('pctBefore: $pctBefore, ')
          ..write('pctAfter: $pctAfter, ')
          ..write('work: $work, ')
          ..write('issues: $issues, ')
          ..write('photoUuidsJson: $photoUuidsJson, ')
          ..write('serverPhotoCount: $serverPhotoCount, ')
          ..write('reason: $reason, ')
          ..write('serverId: $serverId, ')
          ..write('serverRev: $serverRev, ')
          ..write('docNo: $docNo, ')
          ..write('editableUntil: $editableUntil, ')
          ..write('serverPctAfter: $serverPctAfter, ')
          ..write('syncState: $syncState, ')
          ..write('lastError: $lastError, ')
          ..write('lastErrorCode: $lastErrorCode, ')
          ..write('conflictCopyJson: $conflictCopyJson, ')
          ..write('offline: $offline, ')
          ..write('createdAt: $createdAt, ')
          ..write('updatedAt: $updatedAt, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

class $LocalFieldReportsTable extends LocalFieldReports
    with TableInfo<$LocalFieldReportsTable, LocalFieldReport> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $LocalFieldReportsTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _clientUuidMeta = const VerificationMeta(
    'clientUuid',
  );
  @override
  late final GeneratedColumn<String> clientUuid = GeneratedColumn<String>(
    'client_uuid',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _userSubMeta = const VerificationMeta(
    'userSub',
  );
  @override
  late final GeneratedColumn<String> userSub = GeneratedColumn<String>(
    'user_sub',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _companyIdMeta = const VerificationMeta(
    'companyId',
  );
  @override
  late final GeneratedColumn<int> companyId = GeneratedColumn<int>(
    'company_id',
    aliasedName,
    true,
    type: DriftSqlType.int,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _reportTypeMeta = const VerificationMeta(
    'reportType',
  );
  @override
  late final GeneratedColumn<String> reportType = GeneratedColumn<String>(
    'report_type',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _projectIdMeta = const VerificationMeta(
    'projectId',
  );
  @override
  late final GeneratedColumn<int> projectId = GeneratedColumn<int>(
    'project_id',
    aliasedName,
    false,
    type: DriftSqlType.int,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _projectLabelMeta = const VerificationMeta(
    'projectLabel',
  );
  @override
  late final GeneratedColumn<String> projectLabel = GeneratedColumn<String>(
    'project_label',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
    defaultValue: const Constant(''),
  );
  static const VerificationMeta _unitIdMeta = const VerificationMeta('unitId');
  @override
  late final GeneratedColumn<int> unitId = GeneratedColumn<int>(
    'unit_id',
    aliasedName,
    true,
    type: DriftSqlType.int,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _clientIdMeta = const VerificationMeta(
    'clientId',
  );
  @override
  late final GeneratedColumn<int> clientId = GeneratedColumn<int>(
    'client_id',
    aliasedName,
    true,
    type: DriftSqlType.int,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _reportDateMeta = const VerificationMeta(
    'reportDate',
  );
  @override
  late final GeneratedColumn<String> reportDate = GeneratedColumn<String>(
    'report_date',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _hourMeterMeta = const VerificationMeta(
    'hourMeter',
  );
  @override
  late final GeneratedColumn<double> hourMeter = GeneratedColumn<double>(
    'hour_meter',
    aliasedName,
    true,
    type: DriftSqlType.double,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _contentJsonMeta = const VerificationMeta(
    'contentJson',
  );
  @override
  late final GeneratedColumn<String> contentJson = GeneratedColumn<String>(
    'content_json',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
    defaultValue: const Constant('{}'),
  );
  static const VerificationMeta _photoUuidsJsonMeta = const VerificationMeta(
    'photoUuidsJson',
  );
  @override
  late final GeneratedColumn<String> photoUuidsJson = GeneratedColumn<String>(
    'photo_uuids_json',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
    defaultValue: const Constant('[]'),
  );
  static const VerificationMeta _serverPhotoCountMeta = const VerificationMeta(
    'serverPhotoCount',
  );
  @override
  late final GeneratedColumn<int> serverPhotoCount = GeneratedColumn<int>(
    'server_photo_count',
    aliasedName,
    false,
    type: DriftSqlType.int,
    requiredDuringInsert: false,
    defaultValue: const Constant(0),
  );
  static const VerificationMeta _reasonMeta = const VerificationMeta('reason');
  @override
  late final GeneratedColumn<String> reason = GeneratedColumn<String>(
    'reason',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _serverIdMeta = const VerificationMeta(
    'serverId',
  );
  @override
  late final GeneratedColumn<int> serverId = GeneratedColumn<int>(
    'server_id',
    aliasedName,
    true,
    type: DriftSqlType.int,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _serverRevMeta = const VerificationMeta(
    'serverRev',
  );
  @override
  late final GeneratedColumn<int> serverRev = GeneratedColumn<int>(
    'server_rev',
    aliasedName,
    true,
    type: DriftSqlType.int,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _docNoMeta = const VerificationMeta('docNo');
  @override
  late final GeneratedColumn<String> docNo = GeneratedColumn<String>(
    'doc_no',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _editableUntilMeta = const VerificationMeta(
    'editableUntil',
  );
  @override
  late final GeneratedColumn<String> editableUntil = GeneratedColumn<String>(
    'editable_until',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _syncStateMeta = const VerificationMeta(
    'syncState',
  );
  @override
  late final GeneratedColumn<String> syncState = GeneratedColumn<String>(
    'sync_state',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
    defaultValue: const Constant('local'),
  );
  static const VerificationMeta _lastErrorMeta = const VerificationMeta(
    'lastError',
  );
  @override
  late final GeneratedColumn<String> lastError = GeneratedColumn<String>(
    'last_error',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _lastErrorCodeMeta = const VerificationMeta(
    'lastErrorCode',
  );
  @override
  late final GeneratedColumn<String> lastErrorCode = GeneratedColumn<String>(
    'last_error_code',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _conflictCopyJsonMeta = const VerificationMeta(
    'conflictCopyJson',
  );
  @override
  late final GeneratedColumn<String> conflictCopyJson = GeneratedColumn<String>(
    'conflict_copy_json',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _offlineMeta = const VerificationMeta(
    'offline',
  );
  @override
  late final GeneratedColumn<bool> offline = GeneratedColumn<bool>(
    'offline',
    aliasedName,
    false,
    type: DriftSqlType.bool,
    requiredDuringInsert: false,
    defaultConstraints: GeneratedColumn.constraintIsAlways(
      'CHECK ("offline" IN (0, 1))',
    ),
    defaultValue: const Constant(false),
  );
  static const VerificationMeta _createdAtMeta = const VerificationMeta(
    'createdAt',
  );
  @override
  late final GeneratedColumn<DateTime> createdAt = GeneratedColumn<DateTime>(
    'created_at',
    aliasedName,
    false,
    type: DriftSqlType.dateTime,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _updatedAtMeta = const VerificationMeta(
    'updatedAt',
  );
  @override
  late final GeneratedColumn<DateTime> updatedAt = GeneratedColumn<DateTime>(
    'updated_at',
    aliasedName,
    false,
    type: DriftSqlType.dateTime,
    requiredDuringInsert: true,
  );
  @override
  List<GeneratedColumn> get $columns => [
    clientUuid,
    userSub,
    companyId,
    reportType,
    projectId,
    projectLabel,
    unitId,
    clientId,
    reportDate,
    hourMeter,
    contentJson,
    photoUuidsJson,
    serverPhotoCount,
    reason,
    serverId,
    serverRev,
    docNo,
    editableUntil,
    syncState,
    lastError,
    lastErrorCode,
    conflictCopyJson,
    offline,
    createdAt,
    updatedAt,
  ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'local_field_reports';
  @override
  VerificationContext validateIntegrity(
    Insertable<LocalFieldReport> instance, {
    bool isInserting = false,
  }) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('client_uuid')) {
      context.handle(
        _clientUuidMeta,
        clientUuid.isAcceptableOrUnknown(data['client_uuid']!, _clientUuidMeta),
      );
    } else if (isInserting) {
      context.missing(_clientUuidMeta);
    }
    if (data.containsKey('user_sub')) {
      context.handle(
        _userSubMeta,
        userSub.isAcceptableOrUnknown(data['user_sub']!, _userSubMeta),
      );
    } else if (isInserting) {
      context.missing(_userSubMeta);
    }
    if (data.containsKey('company_id')) {
      context.handle(
        _companyIdMeta,
        companyId.isAcceptableOrUnknown(data['company_id']!, _companyIdMeta),
      );
    }
    if (data.containsKey('report_type')) {
      context.handle(
        _reportTypeMeta,
        reportType.isAcceptableOrUnknown(data['report_type']!, _reportTypeMeta),
      );
    } else if (isInserting) {
      context.missing(_reportTypeMeta);
    }
    if (data.containsKey('project_id')) {
      context.handle(
        _projectIdMeta,
        projectId.isAcceptableOrUnknown(data['project_id']!, _projectIdMeta),
      );
    } else if (isInserting) {
      context.missing(_projectIdMeta);
    }
    if (data.containsKey('project_label')) {
      context.handle(
        _projectLabelMeta,
        projectLabel.isAcceptableOrUnknown(
          data['project_label']!,
          _projectLabelMeta,
        ),
      );
    }
    if (data.containsKey('unit_id')) {
      context.handle(
        _unitIdMeta,
        unitId.isAcceptableOrUnknown(data['unit_id']!, _unitIdMeta),
      );
    }
    if (data.containsKey('client_id')) {
      context.handle(
        _clientIdMeta,
        clientId.isAcceptableOrUnknown(data['client_id']!, _clientIdMeta),
      );
    }
    if (data.containsKey('report_date')) {
      context.handle(
        _reportDateMeta,
        reportDate.isAcceptableOrUnknown(data['report_date']!, _reportDateMeta),
      );
    } else if (isInserting) {
      context.missing(_reportDateMeta);
    }
    if (data.containsKey('hour_meter')) {
      context.handle(
        _hourMeterMeta,
        hourMeter.isAcceptableOrUnknown(data['hour_meter']!, _hourMeterMeta),
      );
    }
    if (data.containsKey('content_json')) {
      context.handle(
        _contentJsonMeta,
        contentJson.isAcceptableOrUnknown(
          data['content_json']!,
          _contentJsonMeta,
        ),
      );
    }
    if (data.containsKey('photo_uuids_json')) {
      context.handle(
        _photoUuidsJsonMeta,
        photoUuidsJson.isAcceptableOrUnknown(
          data['photo_uuids_json']!,
          _photoUuidsJsonMeta,
        ),
      );
    }
    if (data.containsKey('server_photo_count')) {
      context.handle(
        _serverPhotoCountMeta,
        serverPhotoCount.isAcceptableOrUnknown(
          data['server_photo_count']!,
          _serverPhotoCountMeta,
        ),
      );
    }
    if (data.containsKey('reason')) {
      context.handle(
        _reasonMeta,
        reason.isAcceptableOrUnknown(data['reason']!, _reasonMeta),
      );
    }
    if (data.containsKey('server_id')) {
      context.handle(
        _serverIdMeta,
        serverId.isAcceptableOrUnknown(data['server_id']!, _serverIdMeta),
      );
    }
    if (data.containsKey('server_rev')) {
      context.handle(
        _serverRevMeta,
        serverRev.isAcceptableOrUnknown(data['server_rev']!, _serverRevMeta),
      );
    }
    if (data.containsKey('doc_no')) {
      context.handle(
        _docNoMeta,
        docNo.isAcceptableOrUnknown(data['doc_no']!, _docNoMeta),
      );
    }
    if (data.containsKey('editable_until')) {
      context.handle(
        _editableUntilMeta,
        editableUntil.isAcceptableOrUnknown(
          data['editable_until']!,
          _editableUntilMeta,
        ),
      );
    }
    if (data.containsKey('sync_state')) {
      context.handle(
        _syncStateMeta,
        syncState.isAcceptableOrUnknown(data['sync_state']!, _syncStateMeta),
      );
    }
    if (data.containsKey('last_error')) {
      context.handle(
        _lastErrorMeta,
        lastError.isAcceptableOrUnknown(data['last_error']!, _lastErrorMeta),
      );
    }
    if (data.containsKey('last_error_code')) {
      context.handle(
        _lastErrorCodeMeta,
        lastErrorCode.isAcceptableOrUnknown(
          data['last_error_code']!,
          _lastErrorCodeMeta,
        ),
      );
    }
    if (data.containsKey('conflict_copy_json')) {
      context.handle(
        _conflictCopyJsonMeta,
        conflictCopyJson.isAcceptableOrUnknown(
          data['conflict_copy_json']!,
          _conflictCopyJsonMeta,
        ),
      );
    }
    if (data.containsKey('offline')) {
      context.handle(
        _offlineMeta,
        offline.isAcceptableOrUnknown(data['offline']!, _offlineMeta),
      );
    }
    if (data.containsKey('created_at')) {
      context.handle(
        _createdAtMeta,
        createdAt.isAcceptableOrUnknown(data['created_at']!, _createdAtMeta),
      );
    } else if (isInserting) {
      context.missing(_createdAtMeta);
    }
    if (data.containsKey('updated_at')) {
      context.handle(
        _updatedAtMeta,
        updatedAt.isAcceptableOrUnknown(data['updated_at']!, _updatedAtMeta),
      );
    } else if (isInserting) {
      context.missing(_updatedAtMeta);
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {clientUuid};
  @override
  LocalFieldReport map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return LocalFieldReport(
      clientUuid: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}client_uuid'],
      )!,
      userSub: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}user_sub'],
      )!,
      companyId: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}company_id'],
      ),
      reportType: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}report_type'],
      )!,
      projectId: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}project_id'],
      )!,
      projectLabel: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}project_label'],
      )!,
      unitId: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}unit_id'],
      ),
      clientId: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}client_id'],
      ),
      reportDate: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}report_date'],
      )!,
      hourMeter: attachedDatabase.typeMapping.read(
        DriftSqlType.double,
        data['${effectivePrefix}hour_meter'],
      ),
      contentJson: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}content_json'],
      )!,
      photoUuidsJson: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}photo_uuids_json'],
      )!,
      serverPhotoCount: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}server_photo_count'],
      )!,
      reason: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}reason'],
      ),
      serverId: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}server_id'],
      ),
      serverRev: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}server_rev'],
      ),
      docNo: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}doc_no'],
      ),
      editableUntil: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}editable_until'],
      ),
      syncState: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}sync_state'],
      )!,
      lastError: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}last_error'],
      ),
      lastErrorCode: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}last_error_code'],
      ),
      conflictCopyJson: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}conflict_copy_json'],
      ),
      offline: attachedDatabase.typeMapping.read(
        DriftSqlType.bool,
        data['${effectivePrefix}offline'],
      )!,
      createdAt: attachedDatabase.typeMapping.read(
        DriftSqlType.dateTime,
        data['${effectivePrefix}created_at'],
      )!,
      updatedAt: attachedDatabase.typeMapping.read(
        DriftSqlType.dateTime,
        data['${effectivePrefix}updated_at'],
      )!,
    );
  }

  @override
  $LocalFieldReportsTable createAlias(String alias) {
    return $LocalFieldReportsTable(attachedDatabase, alias);
  }
}

class LocalFieldReport extends DataClass
    implements Insertable<LocalFieldReport> {
  final String clientUuid;
  final String userSub;
  final int? companyId;

  /// service_report | unit_timesheet | aftersales_activity | daily_report (v6)
  final String reportType;
  final int projectId;
  final String projectLabel;
  final int? unitId;
  final int? clientId;

  /// Business date `YYYY-MM-DD` (company TZ).
  final String reportDate;

  /// Timesheet: HM akhir; service report: HM saat servis (prefill / HM floor of later reports).
  final double? hourMeter;
  final String contentJson;

  /// Every local photo id (media_blobs, kind `field`) of the report, for clean-up.
  final String photoUuidsJson;
  final int serverPhotoCount;
  final String? reason;
  final int? serverId;
  final int? serverRev;
  final String? docNo;
  final String? editableUntil;

  /// local (draft) | queued | synced | conflict | rejected
  final String syncState;
  final String? lastError;
  final String? lastErrorCode;

  /// `server_service_report` / `server_unit_timesheet` / `server_aftersales_activity` of a conflict / NOT_EDITABLE.
  final String? conflictCopyJson;
  final bool offline;
  final DateTime createdAt;
  final DateTime updatedAt;
  const LocalFieldReport({
    required this.clientUuid,
    required this.userSub,
    this.companyId,
    required this.reportType,
    required this.projectId,
    required this.projectLabel,
    this.unitId,
    this.clientId,
    required this.reportDate,
    this.hourMeter,
    required this.contentJson,
    required this.photoUuidsJson,
    required this.serverPhotoCount,
    this.reason,
    this.serverId,
    this.serverRev,
    this.docNo,
    this.editableUntil,
    required this.syncState,
    this.lastError,
    this.lastErrorCode,
    this.conflictCopyJson,
    required this.offline,
    required this.createdAt,
    required this.updatedAt,
  });
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['client_uuid'] = Variable<String>(clientUuid);
    map['user_sub'] = Variable<String>(userSub);
    if (!nullToAbsent || companyId != null) {
      map['company_id'] = Variable<int>(companyId);
    }
    map['report_type'] = Variable<String>(reportType);
    map['project_id'] = Variable<int>(projectId);
    map['project_label'] = Variable<String>(projectLabel);
    if (!nullToAbsent || unitId != null) {
      map['unit_id'] = Variable<int>(unitId);
    }
    if (!nullToAbsent || clientId != null) {
      map['client_id'] = Variable<int>(clientId);
    }
    map['report_date'] = Variable<String>(reportDate);
    if (!nullToAbsent || hourMeter != null) {
      map['hour_meter'] = Variable<double>(hourMeter);
    }
    map['content_json'] = Variable<String>(contentJson);
    map['photo_uuids_json'] = Variable<String>(photoUuidsJson);
    map['server_photo_count'] = Variable<int>(serverPhotoCount);
    if (!nullToAbsent || reason != null) {
      map['reason'] = Variable<String>(reason);
    }
    if (!nullToAbsent || serverId != null) {
      map['server_id'] = Variable<int>(serverId);
    }
    if (!nullToAbsent || serverRev != null) {
      map['server_rev'] = Variable<int>(serverRev);
    }
    if (!nullToAbsent || docNo != null) {
      map['doc_no'] = Variable<String>(docNo);
    }
    if (!nullToAbsent || editableUntil != null) {
      map['editable_until'] = Variable<String>(editableUntil);
    }
    map['sync_state'] = Variable<String>(syncState);
    if (!nullToAbsent || lastError != null) {
      map['last_error'] = Variable<String>(lastError);
    }
    if (!nullToAbsent || lastErrorCode != null) {
      map['last_error_code'] = Variable<String>(lastErrorCode);
    }
    if (!nullToAbsent || conflictCopyJson != null) {
      map['conflict_copy_json'] = Variable<String>(conflictCopyJson);
    }
    map['offline'] = Variable<bool>(offline);
    map['created_at'] = Variable<DateTime>(createdAt);
    map['updated_at'] = Variable<DateTime>(updatedAt);
    return map;
  }

  LocalFieldReportsCompanion toCompanion(bool nullToAbsent) {
    return LocalFieldReportsCompanion(
      clientUuid: Value(clientUuid),
      userSub: Value(userSub),
      companyId: companyId == null && nullToAbsent
          ? const Value.absent()
          : Value(companyId),
      reportType: Value(reportType),
      projectId: Value(projectId),
      projectLabel: Value(projectLabel),
      unitId: unitId == null && nullToAbsent
          ? const Value.absent()
          : Value(unitId),
      clientId: clientId == null && nullToAbsent
          ? const Value.absent()
          : Value(clientId),
      reportDate: Value(reportDate),
      hourMeter: hourMeter == null && nullToAbsent
          ? const Value.absent()
          : Value(hourMeter),
      contentJson: Value(contentJson),
      photoUuidsJson: Value(photoUuidsJson),
      serverPhotoCount: Value(serverPhotoCount),
      reason: reason == null && nullToAbsent
          ? const Value.absent()
          : Value(reason),
      serverId: serverId == null && nullToAbsent
          ? const Value.absent()
          : Value(serverId),
      serverRev: serverRev == null && nullToAbsent
          ? const Value.absent()
          : Value(serverRev),
      docNo: docNo == null && nullToAbsent
          ? const Value.absent()
          : Value(docNo),
      editableUntil: editableUntil == null && nullToAbsent
          ? const Value.absent()
          : Value(editableUntil),
      syncState: Value(syncState),
      lastError: lastError == null && nullToAbsent
          ? const Value.absent()
          : Value(lastError),
      lastErrorCode: lastErrorCode == null && nullToAbsent
          ? const Value.absent()
          : Value(lastErrorCode),
      conflictCopyJson: conflictCopyJson == null && nullToAbsent
          ? const Value.absent()
          : Value(conflictCopyJson),
      offline: Value(offline),
      createdAt: Value(createdAt),
      updatedAt: Value(updatedAt),
    );
  }

  factory LocalFieldReport.fromJson(
    Map<String, dynamic> json, {
    ValueSerializer? serializer,
  }) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return LocalFieldReport(
      clientUuid: serializer.fromJson<String>(json['clientUuid']),
      userSub: serializer.fromJson<String>(json['userSub']),
      companyId: serializer.fromJson<int?>(json['companyId']),
      reportType: serializer.fromJson<String>(json['reportType']),
      projectId: serializer.fromJson<int>(json['projectId']),
      projectLabel: serializer.fromJson<String>(json['projectLabel']),
      unitId: serializer.fromJson<int?>(json['unitId']),
      clientId: serializer.fromJson<int?>(json['clientId']),
      reportDate: serializer.fromJson<String>(json['reportDate']),
      hourMeter: serializer.fromJson<double?>(json['hourMeter']),
      contentJson: serializer.fromJson<String>(json['contentJson']),
      photoUuidsJson: serializer.fromJson<String>(json['photoUuidsJson']),
      serverPhotoCount: serializer.fromJson<int>(json['serverPhotoCount']),
      reason: serializer.fromJson<String?>(json['reason']),
      serverId: serializer.fromJson<int?>(json['serverId']),
      serverRev: serializer.fromJson<int?>(json['serverRev']),
      docNo: serializer.fromJson<String?>(json['docNo']),
      editableUntil: serializer.fromJson<String?>(json['editableUntil']),
      syncState: serializer.fromJson<String>(json['syncState']),
      lastError: serializer.fromJson<String?>(json['lastError']),
      lastErrorCode: serializer.fromJson<String?>(json['lastErrorCode']),
      conflictCopyJson: serializer.fromJson<String?>(json['conflictCopyJson']),
      offline: serializer.fromJson<bool>(json['offline']),
      createdAt: serializer.fromJson<DateTime>(json['createdAt']),
      updatedAt: serializer.fromJson<DateTime>(json['updatedAt']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'clientUuid': serializer.toJson<String>(clientUuid),
      'userSub': serializer.toJson<String>(userSub),
      'companyId': serializer.toJson<int?>(companyId),
      'reportType': serializer.toJson<String>(reportType),
      'projectId': serializer.toJson<int>(projectId),
      'projectLabel': serializer.toJson<String>(projectLabel),
      'unitId': serializer.toJson<int?>(unitId),
      'clientId': serializer.toJson<int?>(clientId),
      'reportDate': serializer.toJson<String>(reportDate),
      'hourMeter': serializer.toJson<double?>(hourMeter),
      'contentJson': serializer.toJson<String>(contentJson),
      'photoUuidsJson': serializer.toJson<String>(photoUuidsJson),
      'serverPhotoCount': serializer.toJson<int>(serverPhotoCount),
      'reason': serializer.toJson<String?>(reason),
      'serverId': serializer.toJson<int?>(serverId),
      'serverRev': serializer.toJson<int?>(serverRev),
      'docNo': serializer.toJson<String?>(docNo),
      'editableUntil': serializer.toJson<String?>(editableUntil),
      'syncState': serializer.toJson<String>(syncState),
      'lastError': serializer.toJson<String?>(lastError),
      'lastErrorCode': serializer.toJson<String?>(lastErrorCode),
      'conflictCopyJson': serializer.toJson<String?>(conflictCopyJson),
      'offline': serializer.toJson<bool>(offline),
      'createdAt': serializer.toJson<DateTime>(createdAt),
      'updatedAt': serializer.toJson<DateTime>(updatedAt),
    };
  }

  LocalFieldReport copyWith({
    String? clientUuid,
    String? userSub,
    Value<int?> companyId = const Value.absent(),
    String? reportType,
    int? projectId,
    String? projectLabel,
    Value<int?> unitId = const Value.absent(),
    Value<int?> clientId = const Value.absent(),
    String? reportDate,
    Value<double?> hourMeter = const Value.absent(),
    String? contentJson,
    String? photoUuidsJson,
    int? serverPhotoCount,
    Value<String?> reason = const Value.absent(),
    Value<int?> serverId = const Value.absent(),
    Value<int?> serverRev = const Value.absent(),
    Value<String?> docNo = const Value.absent(),
    Value<String?> editableUntil = const Value.absent(),
    String? syncState,
    Value<String?> lastError = const Value.absent(),
    Value<String?> lastErrorCode = const Value.absent(),
    Value<String?> conflictCopyJson = const Value.absent(),
    bool? offline,
    DateTime? createdAt,
    DateTime? updatedAt,
  }) => LocalFieldReport(
    clientUuid: clientUuid ?? this.clientUuid,
    userSub: userSub ?? this.userSub,
    companyId: companyId.present ? companyId.value : this.companyId,
    reportType: reportType ?? this.reportType,
    projectId: projectId ?? this.projectId,
    projectLabel: projectLabel ?? this.projectLabel,
    unitId: unitId.present ? unitId.value : this.unitId,
    clientId: clientId.present ? clientId.value : this.clientId,
    reportDate: reportDate ?? this.reportDate,
    hourMeter: hourMeter.present ? hourMeter.value : this.hourMeter,
    contentJson: contentJson ?? this.contentJson,
    photoUuidsJson: photoUuidsJson ?? this.photoUuidsJson,
    serverPhotoCount: serverPhotoCount ?? this.serverPhotoCount,
    reason: reason.present ? reason.value : this.reason,
    serverId: serverId.present ? serverId.value : this.serverId,
    serverRev: serverRev.present ? serverRev.value : this.serverRev,
    docNo: docNo.present ? docNo.value : this.docNo,
    editableUntil: editableUntil.present
        ? editableUntil.value
        : this.editableUntil,
    syncState: syncState ?? this.syncState,
    lastError: lastError.present ? lastError.value : this.lastError,
    lastErrorCode: lastErrorCode.present
        ? lastErrorCode.value
        : this.lastErrorCode,
    conflictCopyJson: conflictCopyJson.present
        ? conflictCopyJson.value
        : this.conflictCopyJson,
    offline: offline ?? this.offline,
    createdAt: createdAt ?? this.createdAt,
    updatedAt: updatedAt ?? this.updatedAt,
  );
  LocalFieldReport copyWithCompanion(LocalFieldReportsCompanion data) {
    return LocalFieldReport(
      clientUuid: data.clientUuid.present
          ? data.clientUuid.value
          : this.clientUuid,
      userSub: data.userSub.present ? data.userSub.value : this.userSub,
      companyId: data.companyId.present ? data.companyId.value : this.companyId,
      reportType: data.reportType.present
          ? data.reportType.value
          : this.reportType,
      projectId: data.projectId.present ? data.projectId.value : this.projectId,
      projectLabel: data.projectLabel.present
          ? data.projectLabel.value
          : this.projectLabel,
      unitId: data.unitId.present ? data.unitId.value : this.unitId,
      clientId: data.clientId.present ? data.clientId.value : this.clientId,
      reportDate: data.reportDate.present
          ? data.reportDate.value
          : this.reportDate,
      hourMeter: data.hourMeter.present ? data.hourMeter.value : this.hourMeter,
      contentJson: data.contentJson.present
          ? data.contentJson.value
          : this.contentJson,
      photoUuidsJson: data.photoUuidsJson.present
          ? data.photoUuidsJson.value
          : this.photoUuidsJson,
      serverPhotoCount: data.serverPhotoCount.present
          ? data.serverPhotoCount.value
          : this.serverPhotoCount,
      reason: data.reason.present ? data.reason.value : this.reason,
      serverId: data.serverId.present ? data.serverId.value : this.serverId,
      serverRev: data.serverRev.present ? data.serverRev.value : this.serverRev,
      docNo: data.docNo.present ? data.docNo.value : this.docNo,
      editableUntil: data.editableUntil.present
          ? data.editableUntil.value
          : this.editableUntil,
      syncState: data.syncState.present ? data.syncState.value : this.syncState,
      lastError: data.lastError.present ? data.lastError.value : this.lastError,
      lastErrorCode: data.lastErrorCode.present
          ? data.lastErrorCode.value
          : this.lastErrorCode,
      conflictCopyJson: data.conflictCopyJson.present
          ? data.conflictCopyJson.value
          : this.conflictCopyJson,
      offline: data.offline.present ? data.offline.value : this.offline,
      createdAt: data.createdAt.present ? data.createdAt.value : this.createdAt,
      updatedAt: data.updatedAt.present ? data.updatedAt.value : this.updatedAt,
    );
  }

  @override
  String toString() {
    return (StringBuffer('LocalFieldReport(')
          ..write('clientUuid: $clientUuid, ')
          ..write('userSub: $userSub, ')
          ..write('companyId: $companyId, ')
          ..write('reportType: $reportType, ')
          ..write('projectId: $projectId, ')
          ..write('projectLabel: $projectLabel, ')
          ..write('unitId: $unitId, ')
          ..write('clientId: $clientId, ')
          ..write('reportDate: $reportDate, ')
          ..write('hourMeter: $hourMeter, ')
          ..write('contentJson: $contentJson, ')
          ..write('photoUuidsJson: $photoUuidsJson, ')
          ..write('serverPhotoCount: $serverPhotoCount, ')
          ..write('reason: $reason, ')
          ..write('serverId: $serverId, ')
          ..write('serverRev: $serverRev, ')
          ..write('docNo: $docNo, ')
          ..write('editableUntil: $editableUntil, ')
          ..write('syncState: $syncState, ')
          ..write('lastError: $lastError, ')
          ..write('lastErrorCode: $lastErrorCode, ')
          ..write('conflictCopyJson: $conflictCopyJson, ')
          ..write('offline: $offline, ')
          ..write('createdAt: $createdAt, ')
          ..write('updatedAt: $updatedAt')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hashAll([
    clientUuid,
    userSub,
    companyId,
    reportType,
    projectId,
    projectLabel,
    unitId,
    clientId,
    reportDate,
    hourMeter,
    contentJson,
    photoUuidsJson,
    serverPhotoCount,
    reason,
    serverId,
    serverRev,
    docNo,
    editableUntil,
    syncState,
    lastError,
    lastErrorCode,
    conflictCopyJson,
    offline,
    createdAt,
    updatedAt,
  ]);
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is LocalFieldReport &&
          other.clientUuid == this.clientUuid &&
          other.userSub == this.userSub &&
          other.companyId == this.companyId &&
          other.reportType == this.reportType &&
          other.projectId == this.projectId &&
          other.projectLabel == this.projectLabel &&
          other.unitId == this.unitId &&
          other.clientId == this.clientId &&
          other.reportDate == this.reportDate &&
          other.hourMeter == this.hourMeter &&
          other.contentJson == this.contentJson &&
          other.photoUuidsJson == this.photoUuidsJson &&
          other.serverPhotoCount == this.serverPhotoCount &&
          other.reason == this.reason &&
          other.serverId == this.serverId &&
          other.serverRev == this.serverRev &&
          other.docNo == this.docNo &&
          other.editableUntil == this.editableUntil &&
          other.syncState == this.syncState &&
          other.lastError == this.lastError &&
          other.lastErrorCode == this.lastErrorCode &&
          other.conflictCopyJson == this.conflictCopyJson &&
          other.offline == this.offline &&
          other.createdAt == this.createdAt &&
          other.updatedAt == this.updatedAt);
}

class LocalFieldReportsCompanion extends UpdateCompanion<LocalFieldReport> {
  final Value<String> clientUuid;
  final Value<String> userSub;
  final Value<int?> companyId;
  final Value<String> reportType;
  final Value<int> projectId;
  final Value<String> projectLabel;
  final Value<int?> unitId;
  final Value<int?> clientId;
  final Value<String> reportDate;
  final Value<double?> hourMeter;
  final Value<String> contentJson;
  final Value<String> photoUuidsJson;
  final Value<int> serverPhotoCount;
  final Value<String?> reason;
  final Value<int?> serverId;
  final Value<int?> serverRev;
  final Value<String?> docNo;
  final Value<String?> editableUntil;
  final Value<String> syncState;
  final Value<String?> lastError;
  final Value<String?> lastErrorCode;
  final Value<String?> conflictCopyJson;
  final Value<bool> offline;
  final Value<DateTime> createdAt;
  final Value<DateTime> updatedAt;
  final Value<int> rowid;
  const LocalFieldReportsCompanion({
    this.clientUuid = const Value.absent(),
    this.userSub = const Value.absent(),
    this.companyId = const Value.absent(),
    this.reportType = const Value.absent(),
    this.projectId = const Value.absent(),
    this.projectLabel = const Value.absent(),
    this.unitId = const Value.absent(),
    this.clientId = const Value.absent(),
    this.reportDate = const Value.absent(),
    this.hourMeter = const Value.absent(),
    this.contentJson = const Value.absent(),
    this.photoUuidsJson = const Value.absent(),
    this.serverPhotoCount = const Value.absent(),
    this.reason = const Value.absent(),
    this.serverId = const Value.absent(),
    this.serverRev = const Value.absent(),
    this.docNo = const Value.absent(),
    this.editableUntil = const Value.absent(),
    this.syncState = const Value.absent(),
    this.lastError = const Value.absent(),
    this.lastErrorCode = const Value.absent(),
    this.conflictCopyJson = const Value.absent(),
    this.offline = const Value.absent(),
    this.createdAt = const Value.absent(),
    this.updatedAt = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  LocalFieldReportsCompanion.insert({
    required String clientUuid,
    required String userSub,
    this.companyId = const Value.absent(),
    required String reportType,
    required int projectId,
    this.projectLabel = const Value.absent(),
    this.unitId = const Value.absent(),
    this.clientId = const Value.absent(),
    required String reportDate,
    this.hourMeter = const Value.absent(),
    this.contentJson = const Value.absent(),
    this.photoUuidsJson = const Value.absent(),
    this.serverPhotoCount = const Value.absent(),
    this.reason = const Value.absent(),
    this.serverId = const Value.absent(),
    this.serverRev = const Value.absent(),
    this.docNo = const Value.absent(),
    this.editableUntil = const Value.absent(),
    this.syncState = const Value.absent(),
    this.lastError = const Value.absent(),
    this.lastErrorCode = const Value.absent(),
    this.conflictCopyJson = const Value.absent(),
    this.offline = const Value.absent(),
    required DateTime createdAt,
    required DateTime updatedAt,
    this.rowid = const Value.absent(),
  }) : clientUuid = Value(clientUuid),
       userSub = Value(userSub),
       reportType = Value(reportType),
       projectId = Value(projectId),
       reportDate = Value(reportDate),
       createdAt = Value(createdAt),
       updatedAt = Value(updatedAt);
  static Insertable<LocalFieldReport> custom({
    Expression<String>? clientUuid,
    Expression<String>? userSub,
    Expression<int>? companyId,
    Expression<String>? reportType,
    Expression<int>? projectId,
    Expression<String>? projectLabel,
    Expression<int>? unitId,
    Expression<int>? clientId,
    Expression<String>? reportDate,
    Expression<double>? hourMeter,
    Expression<String>? contentJson,
    Expression<String>? photoUuidsJson,
    Expression<int>? serverPhotoCount,
    Expression<String>? reason,
    Expression<int>? serverId,
    Expression<int>? serverRev,
    Expression<String>? docNo,
    Expression<String>? editableUntil,
    Expression<String>? syncState,
    Expression<String>? lastError,
    Expression<String>? lastErrorCode,
    Expression<String>? conflictCopyJson,
    Expression<bool>? offline,
    Expression<DateTime>? createdAt,
    Expression<DateTime>? updatedAt,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (clientUuid != null) 'client_uuid': clientUuid,
      if (userSub != null) 'user_sub': userSub,
      if (companyId != null) 'company_id': companyId,
      if (reportType != null) 'report_type': reportType,
      if (projectId != null) 'project_id': projectId,
      if (projectLabel != null) 'project_label': projectLabel,
      if (unitId != null) 'unit_id': unitId,
      if (clientId != null) 'client_id': clientId,
      if (reportDate != null) 'report_date': reportDate,
      if (hourMeter != null) 'hour_meter': hourMeter,
      if (contentJson != null) 'content_json': contentJson,
      if (photoUuidsJson != null) 'photo_uuids_json': photoUuidsJson,
      if (serverPhotoCount != null) 'server_photo_count': serverPhotoCount,
      if (reason != null) 'reason': reason,
      if (serverId != null) 'server_id': serverId,
      if (serverRev != null) 'server_rev': serverRev,
      if (docNo != null) 'doc_no': docNo,
      if (editableUntil != null) 'editable_until': editableUntil,
      if (syncState != null) 'sync_state': syncState,
      if (lastError != null) 'last_error': lastError,
      if (lastErrorCode != null) 'last_error_code': lastErrorCode,
      if (conflictCopyJson != null) 'conflict_copy_json': conflictCopyJson,
      if (offline != null) 'offline': offline,
      if (createdAt != null) 'created_at': createdAt,
      if (updatedAt != null) 'updated_at': updatedAt,
      if (rowid != null) 'rowid': rowid,
    });
  }

  LocalFieldReportsCompanion copyWith({
    Value<String>? clientUuid,
    Value<String>? userSub,
    Value<int?>? companyId,
    Value<String>? reportType,
    Value<int>? projectId,
    Value<String>? projectLabel,
    Value<int?>? unitId,
    Value<int?>? clientId,
    Value<String>? reportDate,
    Value<double?>? hourMeter,
    Value<String>? contentJson,
    Value<String>? photoUuidsJson,
    Value<int>? serverPhotoCount,
    Value<String?>? reason,
    Value<int?>? serverId,
    Value<int?>? serverRev,
    Value<String?>? docNo,
    Value<String?>? editableUntil,
    Value<String>? syncState,
    Value<String?>? lastError,
    Value<String?>? lastErrorCode,
    Value<String?>? conflictCopyJson,
    Value<bool>? offline,
    Value<DateTime>? createdAt,
    Value<DateTime>? updatedAt,
    Value<int>? rowid,
  }) {
    return LocalFieldReportsCompanion(
      clientUuid: clientUuid ?? this.clientUuid,
      userSub: userSub ?? this.userSub,
      companyId: companyId ?? this.companyId,
      reportType: reportType ?? this.reportType,
      projectId: projectId ?? this.projectId,
      projectLabel: projectLabel ?? this.projectLabel,
      unitId: unitId ?? this.unitId,
      clientId: clientId ?? this.clientId,
      reportDate: reportDate ?? this.reportDate,
      hourMeter: hourMeter ?? this.hourMeter,
      contentJson: contentJson ?? this.contentJson,
      photoUuidsJson: photoUuidsJson ?? this.photoUuidsJson,
      serverPhotoCount: serverPhotoCount ?? this.serverPhotoCount,
      reason: reason ?? this.reason,
      serverId: serverId ?? this.serverId,
      serverRev: serverRev ?? this.serverRev,
      docNo: docNo ?? this.docNo,
      editableUntil: editableUntil ?? this.editableUntil,
      syncState: syncState ?? this.syncState,
      lastError: lastError ?? this.lastError,
      lastErrorCode: lastErrorCode ?? this.lastErrorCode,
      conflictCopyJson: conflictCopyJson ?? this.conflictCopyJson,
      offline: offline ?? this.offline,
      createdAt: createdAt ?? this.createdAt,
      updatedAt: updatedAt ?? this.updatedAt,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (clientUuid.present) {
      map['client_uuid'] = Variable<String>(clientUuid.value);
    }
    if (userSub.present) {
      map['user_sub'] = Variable<String>(userSub.value);
    }
    if (companyId.present) {
      map['company_id'] = Variable<int>(companyId.value);
    }
    if (reportType.present) {
      map['report_type'] = Variable<String>(reportType.value);
    }
    if (projectId.present) {
      map['project_id'] = Variable<int>(projectId.value);
    }
    if (projectLabel.present) {
      map['project_label'] = Variable<String>(projectLabel.value);
    }
    if (unitId.present) {
      map['unit_id'] = Variable<int>(unitId.value);
    }
    if (clientId.present) {
      map['client_id'] = Variable<int>(clientId.value);
    }
    if (reportDate.present) {
      map['report_date'] = Variable<String>(reportDate.value);
    }
    if (hourMeter.present) {
      map['hour_meter'] = Variable<double>(hourMeter.value);
    }
    if (contentJson.present) {
      map['content_json'] = Variable<String>(contentJson.value);
    }
    if (photoUuidsJson.present) {
      map['photo_uuids_json'] = Variable<String>(photoUuidsJson.value);
    }
    if (serverPhotoCount.present) {
      map['server_photo_count'] = Variable<int>(serverPhotoCount.value);
    }
    if (reason.present) {
      map['reason'] = Variable<String>(reason.value);
    }
    if (serverId.present) {
      map['server_id'] = Variable<int>(serverId.value);
    }
    if (serverRev.present) {
      map['server_rev'] = Variable<int>(serverRev.value);
    }
    if (docNo.present) {
      map['doc_no'] = Variable<String>(docNo.value);
    }
    if (editableUntil.present) {
      map['editable_until'] = Variable<String>(editableUntil.value);
    }
    if (syncState.present) {
      map['sync_state'] = Variable<String>(syncState.value);
    }
    if (lastError.present) {
      map['last_error'] = Variable<String>(lastError.value);
    }
    if (lastErrorCode.present) {
      map['last_error_code'] = Variable<String>(lastErrorCode.value);
    }
    if (conflictCopyJson.present) {
      map['conflict_copy_json'] = Variable<String>(conflictCopyJson.value);
    }
    if (offline.present) {
      map['offline'] = Variable<bool>(offline.value);
    }
    if (createdAt.present) {
      map['created_at'] = Variable<DateTime>(createdAt.value);
    }
    if (updatedAt.present) {
      map['updated_at'] = Variable<DateTime>(updatedAt.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('LocalFieldReportsCompanion(')
          ..write('clientUuid: $clientUuid, ')
          ..write('userSub: $userSub, ')
          ..write('companyId: $companyId, ')
          ..write('reportType: $reportType, ')
          ..write('projectId: $projectId, ')
          ..write('projectLabel: $projectLabel, ')
          ..write('unitId: $unitId, ')
          ..write('clientId: $clientId, ')
          ..write('reportDate: $reportDate, ')
          ..write('hourMeter: $hourMeter, ')
          ..write('contentJson: $contentJson, ')
          ..write('photoUuidsJson: $photoUuidsJson, ')
          ..write('serverPhotoCount: $serverPhotoCount, ')
          ..write('reason: $reason, ')
          ..write('serverId: $serverId, ')
          ..write('serverRev: $serverRev, ')
          ..write('docNo: $docNo, ')
          ..write('editableUntil: $editableUntil, ')
          ..write('syncState: $syncState, ')
          ..write('lastError: $lastError, ')
          ..write('lastErrorCode: $lastErrorCode, ')
          ..write('conflictCopyJson: $conflictCopyJson, ')
          ..write('offline: $offline, ')
          ..write('createdAt: $createdAt, ')
          ..write('updatedAt: $updatedAt, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

class $FieldUnitsTable extends FieldUnits
    with TableInfo<$FieldUnitsTable, FieldUnitRow> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $FieldUnitsTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _userSubMeta = const VerificationMeta(
    'userSub',
  );
  @override
  late final GeneratedColumn<String> userSub = GeneratedColumn<String>(
    'user_sub',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _idMeta = const VerificationMeta('id');
  @override
  late final GeneratedColumn<int> id = GeneratedColumn<int>(
    'id',
    aliasedName,
    false,
    type: DriftSqlType.int,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _companyIdMeta = const VerificationMeta(
    'companyId',
  );
  @override
  late final GeneratedColumn<int> companyId = GeneratedColumn<int>(
    'company_id',
    aliasedName,
    false,
    type: DriftSqlType.int,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _kindMeta = const VerificationMeta('kind');
  @override
  late final GeneratedColumn<String> kind = GeneratedColumn<String>(
    'kind',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
    defaultValue: const Constant('alat_berat'),
  );
  static const VerificationMeta _labelMeta = const VerificationMeta('label');
  @override
  late final GeneratedColumn<String> label = GeneratedColumn<String>(
    'label',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
    defaultValue: const Constant(''),
  );
  static const VerificationMeta _unitCodeMeta = const VerificationMeta(
    'unitCode',
  );
  @override
  late final GeneratedColumn<String> unitCode = GeneratedColumn<String>(
    'unit_code',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _plateDisplayMeta = const VerificationMeta(
    'plateDisplay',
  );
  @override
  late final GeneratedColumn<String> plateDisplay = GeneratedColumn<String>(
    'plate_display',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _unitTypeMeta = const VerificationMeta(
    'unitType',
  );
  @override
  late final GeneratedColumn<String> unitType = GeneratedColumn<String>(
    'unit_type',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _brandModelMeta = const VerificationMeta(
    'brandModel',
  );
  @override
  late final GeneratedColumn<String> brandModel = GeneratedColumn<String>(
    'brand_model',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _serialNoMeta = const VerificationMeta(
    'serialNo',
  );
  @override
  late final GeneratedColumn<String> serialNo = GeneratedColumn<String>(
    'serial_no',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _ownerMeta = const VerificationMeta('owner');
  @override
  late final GeneratedColumn<String> owner = GeneratedColumn<String>(
    'owner',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
    defaultValue: const Constant('sendiri'),
  );
  static const VerificationMeta _clientIdMeta = const VerificationMeta(
    'clientId',
  );
  @override
  late final GeneratedColumn<int> clientId = GeneratedColumn<int>(
    'client_id',
    aliasedName,
    true,
    type: DriftSqlType.int,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _clientNameMeta = const VerificationMeta(
    'clientName',
  );
  @override
  late final GeneratedColumn<String> clientName = GeneratedColumn<String>(
    'client_name',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _statusMeta = const VerificationMeta('status');
  @override
  late final GeneratedColumn<String> status = GeneratedColumn<String>(
    'status',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
    defaultValue: const Constant('siap'),
  );
  static const VerificationMeta _lastHourMeterMeta = const VerificationMeta(
    'lastHourMeter',
  );
  @override
  late final GeneratedColumn<double> lastHourMeter = GeneratedColumn<double>(
    'last_hour_meter',
    aliasedName,
    true,
    type: DriftSqlType.double,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _lastHourMeterAtMeta = const VerificationMeta(
    'lastHourMeterAt',
  );
  @override
  late final GeneratedColumn<String> lastHourMeterAt = GeneratedColumn<String>(
    'last_hour_meter_at',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _activeMeta = const VerificationMeta('active');
  @override
  late final GeneratedColumn<bool> active = GeneratedColumn<bool>(
    'active',
    aliasedName,
    false,
    type: DriftSqlType.bool,
    requiredDuringInsert: false,
    defaultConstraints: GeneratedColumn.constraintIsAlways(
      'CHECK ("active" IN (0, 1))',
    ),
    defaultValue: const Constant(true),
  );
  static const VerificationMeta _updatedAtMeta = const VerificationMeta(
    'updatedAt',
  );
  @override
  late final GeneratedColumn<String> updatedAt = GeneratedColumn<String>(
    'updated_at',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  @override
  List<GeneratedColumn> get $columns => [
    userSub,
    id,
    companyId,
    kind,
    label,
    unitCode,
    plateDisplay,
    unitType,
    brandModel,
    serialNo,
    owner,
    clientId,
    clientName,
    status,
    lastHourMeter,
    lastHourMeterAt,
    active,
    updatedAt,
  ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'field_units';
  @override
  VerificationContext validateIntegrity(
    Insertable<FieldUnitRow> instance, {
    bool isInserting = false,
  }) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('user_sub')) {
      context.handle(
        _userSubMeta,
        userSub.isAcceptableOrUnknown(data['user_sub']!, _userSubMeta),
      );
    } else if (isInserting) {
      context.missing(_userSubMeta);
    }
    if (data.containsKey('id')) {
      context.handle(_idMeta, id.isAcceptableOrUnknown(data['id']!, _idMeta));
    } else if (isInserting) {
      context.missing(_idMeta);
    }
    if (data.containsKey('company_id')) {
      context.handle(
        _companyIdMeta,
        companyId.isAcceptableOrUnknown(data['company_id']!, _companyIdMeta),
      );
    } else if (isInserting) {
      context.missing(_companyIdMeta);
    }
    if (data.containsKey('kind')) {
      context.handle(
        _kindMeta,
        kind.isAcceptableOrUnknown(data['kind']!, _kindMeta),
      );
    }
    if (data.containsKey('label')) {
      context.handle(
        _labelMeta,
        label.isAcceptableOrUnknown(data['label']!, _labelMeta),
      );
    }
    if (data.containsKey('unit_code')) {
      context.handle(
        _unitCodeMeta,
        unitCode.isAcceptableOrUnknown(data['unit_code']!, _unitCodeMeta),
      );
    }
    if (data.containsKey('plate_display')) {
      context.handle(
        _plateDisplayMeta,
        plateDisplay.isAcceptableOrUnknown(
          data['plate_display']!,
          _plateDisplayMeta,
        ),
      );
    }
    if (data.containsKey('unit_type')) {
      context.handle(
        _unitTypeMeta,
        unitType.isAcceptableOrUnknown(data['unit_type']!, _unitTypeMeta),
      );
    }
    if (data.containsKey('brand_model')) {
      context.handle(
        _brandModelMeta,
        brandModel.isAcceptableOrUnknown(data['brand_model']!, _brandModelMeta),
      );
    }
    if (data.containsKey('serial_no')) {
      context.handle(
        _serialNoMeta,
        serialNo.isAcceptableOrUnknown(data['serial_no']!, _serialNoMeta),
      );
    }
    if (data.containsKey('owner')) {
      context.handle(
        _ownerMeta,
        owner.isAcceptableOrUnknown(data['owner']!, _ownerMeta),
      );
    }
    if (data.containsKey('client_id')) {
      context.handle(
        _clientIdMeta,
        clientId.isAcceptableOrUnknown(data['client_id']!, _clientIdMeta),
      );
    }
    if (data.containsKey('client_name')) {
      context.handle(
        _clientNameMeta,
        clientName.isAcceptableOrUnknown(data['client_name']!, _clientNameMeta),
      );
    }
    if (data.containsKey('status')) {
      context.handle(
        _statusMeta,
        status.isAcceptableOrUnknown(data['status']!, _statusMeta),
      );
    }
    if (data.containsKey('last_hour_meter')) {
      context.handle(
        _lastHourMeterMeta,
        lastHourMeter.isAcceptableOrUnknown(
          data['last_hour_meter']!,
          _lastHourMeterMeta,
        ),
      );
    }
    if (data.containsKey('last_hour_meter_at')) {
      context.handle(
        _lastHourMeterAtMeta,
        lastHourMeterAt.isAcceptableOrUnknown(
          data['last_hour_meter_at']!,
          _lastHourMeterAtMeta,
        ),
      );
    }
    if (data.containsKey('active')) {
      context.handle(
        _activeMeta,
        active.isAcceptableOrUnknown(data['active']!, _activeMeta),
      );
    }
    if (data.containsKey('updated_at')) {
      context.handle(
        _updatedAtMeta,
        updatedAt.isAcceptableOrUnknown(data['updated_at']!, _updatedAtMeta),
      );
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {userSub, id};
  @override
  FieldUnitRow map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return FieldUnitRow(
      userSub: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}user_sub'],
      )!,
      id: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}id'],
      )!,
      companyId: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}company_id'],
      )!,
      kind: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}kind'],
      )!,
      label: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}label'],
      )!,
      unitCode: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}unit_code'],
      ),
      plateDisplay: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}plate_display'],
      ),
      unitType: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}unit_type'],
      ),
      brandModel: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}brand_model'],
      ),
      serialNo: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}serial_no'],
      ),
      owner: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}owner'],
      )!,
      clientId: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}client_id'],
      ),
      clientName: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}client_name'],
      ),
      status: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}status'],
      )!,
      lastHourMeter: attachedDatabase.typeMapping.read(
        DriftSqlType.double,
        data['${effectivePrefix}last_hour_meter'],
      ),
      lastHourMeterAt: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}last_hour_meter_at'],
      ),
      active: attachedDatabase.typeMapping.read(
        DriftSqlType.bool,
        data['${effectivePrefix}active'],
      )!,
      updatedAt: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}updated_at'],
      ),
    );
  }

  @override
  $FieldUnitsTable createAlias(String alias) {
    return $FieldUnitsTable(attachedDatabase, alias);
  }
}

class FieldUnitRow extends DataClass implements Insertable<FieldUnitRow> {
  final String userSub;
  final int id;
  final int companyId;
  final String kind;
  final String label;
  final String? unitCode;
  final String? plateDisplay;
  final String? unitType;
  final String? brandModel;
  final String? serialNo;

  /// sendiri | pelanggan
  final String owner;
  final int? clientId;
  final String? clientName;

  /// siap | rusak | menunggu_part
  final String status;
  final double? lastHourMeter;
  final String? lastHourMeterAt;
  final bool active;
  final String? updatedAt;
  const FieldUnitRow({
    required this.userSub,
    required this.id,
    required this.companyId,
    required this.kind,
    required this.label,
    this.unitCode,
    this.plateDisplay,
    this.unitType,
    this.brandModel,
    this.serialNo,
    required this.owner,
    this.clientId,
    this.clientName,
    required this.status,
    this.lastHourMeter,
    this.lastHourMeterAt,
    required this.active,
    this.updatedAt,
  });
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['user_sub'] = Variable<String>(userSub);
    map['id'] = Variable<int>(id);
    map['company_id'] = Variable<int>(companyId);
    map['kind'] = Variable<String>(kind);
    map['label'] = Variable<String>(label);
    if (!nullToAbsent || unitCode != null) {
      map['unit_code'] = Variable<String>(unitCode);
    }
    if (!nullToAbsent || plateDisplay != null) {
      map['plate_display'] = Variable<String>(plateDisplay);
    }
    if (!nullToAbsent || unitType != null) {
      map['unit_type'] = Variable<String>(unitType);
    }
    if (!nullToAbsent || brandModel != null) {
      map['brand_model'] = Variable<String>(brandModel);
    }
    if (!nullToAbsent || serialNo != null) {
      map['serial_no'] = Variable<String>(serialNo);
    }
    map['owner'] = Variable<String>(owner);
    if (!nullToAbsent || clientId != null) {
      map['client_id'] = Variable<int>(clientId);
    }
    if (!nullToAbsent || clientName != null) {
      map['client_name'] = Variable<String>(clientName);
    }
    map['status'] = Variable<String>(status);
    if (!nullToAbsent || lastHourMeter != null) {
      map['last_hour_meter'] = Variable<double>(lastHourMeter);
    }
    if (!nullToAbsent || lastHourMeterAt != null) {
      map['last_hour_meter_at'] = Variable<String>(lastHourMeterAt);
    }
    map['active'] = Variable<bool>(active);
    if (!nullToAbsent || updatedAt != null) {
      map['updated_at'] = Variable<String>(updatedAt);
    }
    return map;
  }

  FieldUnitsCompanion toCompanion(bool nullToAbsent) {
    return FieldUnitsCompanion(
      userSub: Value(userSub),
      id: Value(id),
      companyId: Value(companyId),
      kind: Value(kind),
      label: Value(label),
      unitCode: unitCode == null && nullToAbsent
          ? const Value.absent()
          : Value(unitCode),
      plateDisplay: plateDisplay == null && nullToAbsent
          ? const Value.absent()
          : Value(plateDisplay),
      unitType: unitType == null && nullToAbsent
          ? const Value.absent()
          : Value(unitType),
      brandModel: brandModel == null && nullToAbsent
          ? const Value.absent()
          : Value(brandModel),
      serialNo: serialNo == null && nullToAbsent
          ? const Value.absent()
          : Value(serialNo),
      owner: Value(owner),
      clientId: clientId == null && nullToAbsent
          ? const Value.absent()
          : Value(clientId),
      clientName: clientName == null && nullToAbsent
          ? const Value.absent()
          : Value(clientName),
      status: Value(status),
      lastHourMeter: lastHourMeter == null && nullToAbsent
          ? const Value.absent()
          : Value(lastHourMeter),
      lastHourMeterAt: lastHourMeterAt == null && nullToAbsent
          ? const Value.absent()
          : Value(lastHourMeterAt),
      active: Value(active),
      updatedAt: updatedAt == null && nullToAbsent
          ? const Value.absent()
          : Value(updatedAt),
    );
  }

  factory FieldUnitRow.fromJson(
    Map<String, dynamic> json, {
    ValueSerializer? serializer,
  }) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return FieldUnitRow(
      userSub: serializer.fromJson<String>(json['userSub']),
      id: serializer.fromJson<int>(json['id']),
      companyId: serializer.fromJson<int>(json['companyId']),
      kind: serializer.fromJson<String>(json['kind']),
      label: serializer.fromJson<String>(json['label']),
      unitCode: serializer.fromJson<String?>(json['unitCode']),
      plateDisplay: serializer.fromJson<String?>(json['plateDisplay']),
      unitType: serializer.fromJson<String?>(json['unitType']),
      brandModel: serializer.fromJson<String?>(json['brandModel']),
      serialNo: serializer.fromJson<String?>(json['serialNo']),
      owner: serializer.fromJson<String>(json['owner']),
      clientId: serializer.fromJson<int?>(json['clientId']),
      clientName: serializer.fromJson<String?>(json['clientName']),
      status: serializer.fromJson<String>(json['status']),
      lastHourMeter: serializer.fromJson<double?>(json['lastHourMeter']),
      lastHourMeterAt: serializer.fromJson<String?>(json['lastHourMeterAt']),
      active: serializer.fromJson<bool>(json['active']),
      updatedAt: serializer.fromJson<String?>(json['updatedAt']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'userSub': serializer.toJson<String>(userSub),
      'id': serializer.toJson<int>(id),
      'companyId': serializer.toJson<int>(companyId),
      'kind': serializer.toJson<String>(kind),
      'label': serializer.toJson<String>(label),
      'unitCode': serializer.toJson<String?>(unitCode),
      'plateDisplay': serializer.toJson<String?>(plateDisplay),
      'unitType': serializer.toJson<String?>(unitType),
      'brandModel': serializer.toJson<String?>(brandModel),
      'serialNo': serializer.toJson<String?>(serialNo),
      'owner': serializer.toJson<String>(owner),
      'clientId': serializer.toJson<int?>(clientId),
      'clientName': serializer.toJson<String?>(clientName),
      'status': serializer.toJson<String>(status),
      'lastHourMeter': serializer.toJson<double?>(lastHourMeter),
      'lastHourMeterAt': serializer.toJson<String?>(lastHourMeterAt),
      'active': serializer.toJson<bool>(active),
      'updatedAt': serializer.toJson<String?>(updatedAt),
    };
  }

  FieldUnitRow copyWith({
    String? userSub,
    int? id,
    int? companyId,
    String? kind,
    String? label,
    Value<String?> unitCode = const Value.absent(),
    Value<String?> plateDisplay = const Value.absent(),
    Value<String?> unitType = const Value.absent(),
    Value<String?> brandModel = const Value.absent(),
    Value<String?> serialNo = const Value.absent(),
    String? owner,
    Value<int?> clientId = const Value.absent(),
    Value<String?> clientName = const Value.absent(),
    String? status,
    Value<double?> lastHourMeter = const Value.absent(),
    Value<String?> lastHourMeterAt = const Value.absent(),
    bool? active,
    Value<String?> updatedAt = const Value.absent(),
  }) => FieldUnitRow(
    userSub: userSub ?? this.userSub,
    id: id ?? this.id,
    companyId: companyId ?? this.companyId,
    kind: kind ?? this.kind,
    label: label ?? this.label,
    unitCode: unitCode.present ? unitCode.value : this.unitCode,
    plateDisplay: plateDisplay.present ? plateDisplay.value : this.plateDisplay,
    unitType: unitType.present ? unitType.value : this.unitType,
    brandModel: brandModel.present ? brandModel.value : this.brandModel,
    serialNo: serialNo.present ? serialNo.value : this.serialNo,
    owner: owner ?? this.owner,
    clientId: clientId.present ? clientId.value : this.clientId,
    clientName: clientName.present ? clientName.value : this.clientName,
    status: status ?? this.status,
    lastHourMeter: lastHourMeter.present
        ? lastHourMeter.value
        : this.lastHourMeter,
    lastHourMeterAt: lastHourMeterAt.present
        ? lastHourMeterAt.value
        : this.lastHourMeterAt,
    active: active ?? this.active,
    updatedAt: updatedAt.present ? updatedAt.value : this.updatedAt,
  );
  FieldUnitRow copyWithCompanion(FieldUnitsCompanion data) {
    return FieldUnitRow(
      userSub: data.userSub.present ? data.userSub.value : this.userSub,
      id: data.id.present ? data.id.value : this.id,
      companyId: data.companyId.present ? data.companyId.value : this.companyId,
      kind: data.kind.present ? data.kind.value : this.kind,
      label: data.label.present ? data.label.value : this.label,
      unitCode: data.unitCode.present ? data.unitCode.value : this.unitCode,
      plateDisplay: data.plateDisplay.present
          ? data.plateDisplay.value
          : this.plateDisplay,
      unitType: data.unitType.present ? data.unitType.value : this.unitType,
      brandModel: data.brandModel.present
          ? data.brandModel.value
          : this.brandModel,
      serialNo: data.serialNo.present ? data.serialNo.value : this.serialNo,
      owner: data.owner.present ? data.owner.value : this.owner,
      clientId: data.clientId.present ? data.clientId.value : this.clientId,
      clientName: data.clientName.present
          ? data.clientName.value
          : this.clientName,
      status: data.status.present ? data.status.value : this.status,
      lastHourMeter: data.lastHourMeter.present
          ? data.lastHourMeter.value
          : this.lastHourMeter,
      lastHourMeterAt: data.lastHourMeterAt.present
          ? data.lastHourMeterAt.value
          : this.lastHourMeterAt,
      active: data.active.present ? data.active.value : this.active,
      updatedAt: data.updatedAt.present ? data.updatedAt.value : this.updatedAt,
    );
  }

  @override
  String toString() {
    return (StringBuffer('FieldUnitRow(')
          ..write('userSub: $userSub, ')
          ..write('id: $id, ')
          ..write('companyId: $companyId, ')
          ..write('kind: $kind, ')
          ..write('label: $label, ')
          ..write('unitCode: $unitCode, ')
          ..write('plateDisplay: $plateDisplay, ')
          ..write('unitType: $unitType, ')
          ..write('brandModel: $brandModel, ')
          ..write('serialNo: $serialNo, ')
          ..write('owner: $owner, ')
          ..write('clientId: $clientId, ')
          ..write('clientName: $clientName, ')
          ..write('status: $status, ')
          ..write('lastHourMeter: $lastHourMeter, ')
          ..write('lastHourMeterAt: $lastHourMeterAt, ')
          ..write('active: $active, ')
          ..write('updatedAt: $updatedAt')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(
    userSub,
    id,
    companyId,
    kind,
    label,
    unitCode,
    plateDisplay,
    unitType,
    brandModel,
    serialNo,
    owner,
    clientId,
    clientName,
    status,
    lastHourMeter,
    lastHourMeterAt,
    active,
    updatedAt,
  );
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is FieldUnitRow &&
          other.userSub == this.userSub &&
          other.id == this.id &&
          other.companyId == this.companyId &&
          other.kind == this.kind &&
          other.label == this.label &&
          other.unitCode == this.unitCode &&
          other.plateDisplay == this.plateDisplay &&
          other.unitType == this.unitType &&
          other.brandModel == this.brandModel &&
          other.serialNo == this.serialNo &&
          other.owner == this.owner &&
          other.clientId == this.clientId &&
          other.clientName == this.clientName &&
          other.status == this.status &&
          other.lastHourMeter == this.lastHourMeter &&
          other.lastHourMeterAt == this.lastHourMeterAt &&
          other.active == this.active &&
          other.updatedAt == this.updatedAt);
}

class FieldUnitsCompanion extends UpdateCompanion<FieldUnitRow> {
  final Value<String> userSub;
  final Value<int> id;
  final Value<int> companyId;
  final Value<String> kind;
  final Value<String> label;
  final Value<String?> unitCode;
  final Value<String?> plateDisplay;
  final Value<String?> unitType;
  final Value<String?> brandModel;
  final Value<String?> serialNo;
  final Value<String> owner;
  final Value<int?> clientId;
  final Value<String?> clientName;
  final Value<String> status;
  final Value<double?> lastHourMeter;
  final Value<String?> lastHourMeterAt;
  final Value<bool> active;
  final Value<String?> updatedAt;
  final Value<int> rowid;
  const FieldUnitsCompanion({
    this.userSub = const Value.absent(),
    this.id = const Value.absent(),
    this.companyId = const Value.absent(),
    this.kind = const Value.absent(),
    this.label = const Value.absent(),
    this.unitCode = const Value.absent(),
    this.plateDisplay = const Value.absent(),
    this.unitType = const Value.absent(),
    this.brandModel = const Value.absent(),
    this.serialNo = const Value.absent(),
    this.owner = const Value.absent(),
    this.clientId = const Value.absent(),
    this.clientName = const Value.absent(),
    this.status = const Value.absent(),
    this.lastHourMeter = const Value.absent(),
    this.lastHourMeterAt = const Value.absent(),
    this.active = const Value.absent(),
    this.updatedAt = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  FieldUnitsCompanion.insert({
    required String userSub,
    required int id,
    required int companyId,
    this.kind = const Value.absent(),
    this.label = const Value.absent(),
    this.unitCode = const Value.absent(),
    this.plateDisplay = const Value.absent(),
    this.unitType = const Value.absent(),
    this.brandModel = const Value.absent(),
    this.serialNo = const Value.absent(),
    this.owner = const Value.absent(),
    this.clientId = const Value.absent(),
    this.clientName = const Value.absent(),
    this.status = const Value.absent(),
    this.lastHourMeter = const Value.absent(),
    this.lastHourMeterAt = const Value.absent(),
    this.active = const Value.absent(),
    this.updatedAt = const Value.absent(),
    this.rowid = const Value.absent(),
  }) : userSub = Value(userSub),
       id = Value(id),
       companyId = Value(companyId);
  static Insertable<FieldUnitRow> custom({
    Expression<String>? userSub,
    Expression<int>? id,
    Expression<int>? companyId,
    Expression<String>? kind,
    Expression<String>? label,
    Expression<String>? unitCode,
    Expression<String>? plateDisplay,
    Expression<String>? unitType,
    Expression<String>? brandModel,
    Expression<String>? serialNo,
    Expression<String>? owner,
    Expression<int>? clientId,
    Expression<String>? clientName,
    Expression<String>? status,
    Expression<double>? lastHourMeter,
    Expression<String>? lastHourMeterAt,
    Expression<bool>? active,
    Expression<String>? updatedAt,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (userSub != null) 'user_sub': userSub,
      if (id != null) 'id': id,
      if (companyId != null) 'company_id': companyId,
      if (kind != null) 'kind': kind,
      if (label != null) 'label': label,
      if (unitCode != null) 'unit_code': unitCode,
      if (plateDisplay != null) 'plate_display': plateDisplay,
      if (unitType != null) 'unit_type': unitType,
      if (brandModel != null) 'brand_model': brandModel,
      if (serialNo != null) 'serial_no': serialNo,
      if (owner != null) 'owner': owner,
      if (clientId != null) 'client_id': clientId,
      if (clientName != null) 'client_name': clientName,
      if (status != null) 'status': status,
      if (lastHourMeter != null) 'last_hour_meter': lastHourMeter,
      if (lastHourMeterAt != null) 'last_hour_meter_at': lastHourMeterAt,
      if (active != null) 'active': active,
      if (updatedAt != null) 'updated_at': updatedAt,
      if (rowid != null) 'rowid': rowid,
    });
  }

  FieldUnitsCompanion copyWith({
    Value<String>? userSub,
    Value<int>? id,
    Value<int>? companyId,
    Value<String>? kind,
    Value<String>? label,
    Value<String?>? unitCode,
    Value<String?>? plateDisplay,
    Value<String?>? unitType,
    Value<String?>? brandModel,
    Value<String?>? serialNo,
    Value<String>? owner,
    Value<int?>? clientId,
    Value<String?>? clientName,
    Value<String>? status,
    Value<double?>? lastHourMeter,
    Value<String?>? lastHourMeterAt,
    Value<bool>? active,
    Value<String?>? updatedAt,
    Value<int>? rowid,
  }) {
    return FieldUnitsCompanion(
      userSub: userSub ?? this.userSub,
      id: id ?? this.id,
      companyId: companyId ?? this.companyId,
      kind: kind ?? this.kind,
      label: label ?? this.label,
      unitCode: unitCode ?? this.unitCode,
      plateDisplay: plateDisplay ?? this.plateDisplay,
      unitType: unitType ?? this.unitType,
      brandModel: brandModel ?? this.brandModel,
      serialNo: serialNo ?? this.serialNo,
      owner: owner ?? this.owner,
      clientId: clientId ?? this.clientId,
      clientName: clientName ?? this.clientName,
      status: status ?? this.status,
      lastHourMeter: lastHourMeter ?? this.lastHourMeter,
      lastHourMeterAt: lastHourMeterAt ?? this.lastHourMeterAt,
      active: active ?? this.active,
      updatedAt: updatedAt ?? this.updatedAt,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (userSub.present) {
      map['user_sub'] = Variable<String>(userSub.value);
    }
    if (id.present) {
      map['id'] = Variable<int>(id.value);
    }
    if (companyId.present) {
      map['company_id'] = Variable<int>(companyId.value);
    }
    if (kind.present) {
      map['kind'] = Variable<String>(kind.value);
    }
    if (label.present) {
      map['label'] = Variable<String>(label.value);
    }
    if (unitCode.present) {
      map['unit_code'] = Variable<String>(unitCode.value);
    }
    if (plateDisplay.present) {
      map['plate_display'] = Variable<String>(plateDisplay.value);
    }
    if (unitType.present) {
      map['unit_type'] = Variable<String>(unitType.value);
    }
    if (brandModel.present) {
      map['brand_model'] = Variable<String>(brandModel.value);
    }
    if (serialNo.present) {
      map['serial_no'] = Variable<String>(serialNo.value);
    }
    if (owner.present) {
      map['owner'] = Variable<String>(owner.value);
    }
    if (clientId.present) {
      map['client_id'] = Variable<int>(clientId.value);
    }
    if (clientName.present) {
      map['client_name'] = Variable<String>(clientName.value);
    }
    if (status.present) {
      map['status'] = Variable<String>(status.value);
    }
    if (lastHourMeter.present) {
      map['last_hour_meter'] = Variable<double>(lastHourMeter.value);
    }
    if (lastHourMeterAt.present) {
      map['last_hour_meter_at'] = Variable<String>(lastHourMeterAt.value);
    }
    if (active.present) {
      map['active'] = Variable<bool>(active.value);
    }
    if (updatedAt.present) {
      map['updated_at'] = Variable<String>(updatedAt.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('FieldUnitsCompanion(')
          ..write('userSub: $userSub, ')
          ..write('id: $id, ')
          ..write('companyId: $companyId, ')
          ..write('kind: $kind, ')
          ..write('label: $label, ')
          ..write('unitCode: $unitCode, ')
          ..write('plateDisplay: $plateDisplay, ')
          ..write('unitType: $unitType, ')
          ..write('brandModel: $brandModel, ')
          ..write('serialNo: $serialNo, ')
          ..write('owner: $owner, ')
          ..write('clientId: $clientId, ')
          ..write('clientName: $clientName, ')
          ..write('status: $status, ')
          ..write('lastHourMeter: $lastHourMeter, ')
          ..write('lastHourMeterAt: $lastHourMeterAt, ')
          ..write('active: $active, ')
          ..write('updatedAt: $updatedAt, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

class $FieldContractUnitsTable extends FieldContractUnits
    with TableInfo<$FieldContractUnitsTable, FieldContractUnitRow> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $FieldContractUnitsTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _userSubMeta = const VerificationMeta(
    'userSub',
  );
  @override
  late final GeneratedColumn<String> userSub = GeneratedColumn<String>(
    'user_sub',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _idMeta = const VerificationMeta('id');
  @override
  late final GeneratedColumn<int> id = GeneratedColumn<int>(
    'id',
    aliasedName,
    false,
    type: DriftSqlType.int,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _companyIdMeta = const VerificationMeta(
    'companyId',
  );
  @override
  late final GeneratedColumn<int> companyId = GeneratedColumn<int>(
    'company_id',
    aliasedName,
    false,
    type: DriftSqlType.int,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _projectIdMeta = const VerificationMeta(
    'projectId',
  );
  @override
  late final GeneratedColumn<int> projectId = GeneratedColumn<int>(
    'project_id',
    aliasedName,
    false,
    type: DriftSqlType.int,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _unitIdMeta = const VerificationMeta('unitId');
  @override
  late final GeneratedColumn<int> unitId = GeneratedColumn<int>(
    'unit_id',
    aliasedName,
    false,
    type: DriftSqlType.int,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _unitLabelMeta = const VerificationMeta(
    'unitLabel',
  );
  @override
  late final GeneratedColumn<String> unitLabel = GeneratedColumn<String>(
    'unit_label',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
    defaultValue: const Constant(''),
  );
  static const VerificationMeta _unitCodeMeta = const VerificationMeta(
    'unitCode',
  );
  @override
  late final GeneratedColumn<String> unitCode = GeneratedColumn<String>(
    'unit_code',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _startDateMeta = const VerificationMeta(
    'startDate',
  );
  @override
  late final GeneratedColumn<String> startDate = GeneratedColumn<String>(
    'start_date',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _endDateMeta = const VerificationMeta(
    'endDate',
  );
  @override
  late final GeneratedColumn<String> endDate = GeneratedColumn<String>(
    'end_date',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _activeMeta = const VerificationMeta('active');
  @override
  late final GeneratedColumn<bool> active = GeneratedColumn<bool>(
    'active',
    aliasedName,
    false,
    type: DriftSqlType.bool,
    requiredDuringInsert: false,
    defaultConstraints: GeneratedColumn.constraintIsAlways(
      'CHECK ("active" IN (0, 1))',
    ),
    defaultValue: const Constant(true),
  );
  @override
  List<GeneratedColumn> get $columns => [
    userSub,
    id,
    companyId,
    projectId,
    unitId,
    unitLabel,
    unitCode,
    startDate,
    endDate,
    active,
  ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'field_contract_units';
  @override
  VerificationContext validateIntegrity(
    Insertable<FieldContractUnitRow> instance, {
    bool isInserting = false,
  }) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('user_sub')) {
      context.handle(
        _userSubMeta,
        userSub.isAcceptableOrUnknown(data['user_sub']!, _userSubMeta),
      );
    } else if (isInserting) {
      context.missing(_userSubMeta);
    }
    if (data.containsKey('id')) {
      context.handle(_idMeta, id.isAcceptableOrUnknown(data['id']!, _idMeta));
    } else if (isInserting) {
      context.missing(_idMeta);
    }
    if (data.containsKey('company_id')) {
      context.handle(
        _companyIdMeta,
        companyId.isAcceptableOrUnknown(data['company_id']!, _companyIdMeta),
      );
    } else if (isInserting) {
      context.missing(_companyIdMeta);
    }
    if (data.containsKey('project_id')) {
      context.handle(
        _projectIdMeta,
        projectId.isAcceptableOrUnknown(data['project_id']!, _projectIdMeta),
      );
    } else if (isInserting) {
      context.missing(_projectIdMeta);
    }
    if (data.containsKey('unit_id')) {
      context.handle(
        _unitIdMeta,
        unitId.isAcceptableOrUnknown(data['unit_id']!, _unitIdMeta),
      );
    } else if (isInserting) {
      context.missing(_unitIdMeta);
    }
    if (data.containsKey('unit_label')) {
      context.handle(
        _unitLabelMeta,
        unitLabel.isAcceptableOrUnknown(data['unit_label']!, _unitLabelMeta),
      );
    }
    if (data.containsKey('unit_code')) {
      context.handle(
        _unitCodeMeta,
        unitCode.isAcceptableOrUnknown(data['unit_code']!, _unitCodeMeta),
      );
    }
    if (data.containsKey('start_date')) {
      context.handle(
        _startDateMeta,
        startDate.isAcceptableOrUnknown(data['start_date']!, _startDateMeta),
      );
    } else if (isInserting) {
      context.missing(_startDateMeta);
    }
    if (data.containsKey('end_date')) {
      context.handle(
        _endDateMeta,
        endDate.isAcceptableOrUnknown(data['end_date']!, _endDateMeta),
      );
    }
    if (data.containsKey('active')) {
      context.handle(
        _activeMeta,
        active.isAcceptableOrUnknown(data['active']!, _activeMeta),
      );
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {userSub, id};
  @override
  FieldContractUnitRow map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return FieldContractUnitRow(
      userSub: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}user_sub'],
      )!,
      id: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}id'],
      )!,
      companyId: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}company_id'],
      )!,
      projectId: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}project_id'],
      )!,
      unitId: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}unit_id'],
      )!,
      unitLabel: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}unit_label'],
      )!,
      unitCode: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}unit_code'],
      ),
      startDate: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}start_date'],
      )!,
      endDate: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}end_date'],
      ),
      active: attachedDatabase.typeMapping.read(
        DriftSqlType.bool,
        data['${effectivePrefix}active'],
      )!,
    );
  }

  @override
  $FieldContractUnitsTable createAlias(String alias) {
    return $FieldContractUnitsTable(attachedDatabase, alias);
  }
}

class FieldContractUnitRow extends DataClass
    implements Insertable<FieldContractUnitRow> {
  final String userSub;
  final int id;
  final int companyId;
  final int projectId;
  final int unitId;
  final String unitLabel;
  final String? unitCode;
  final String startDate;
  final String? endDate;
  final bool active;
  const FieldContractUnitRow({
    required this.userSub,
    required this.id,
    required this.companyId,
    required this.projectId,
    required this.unitId,
    required this.unitLabel,
    this.unitCode,
    required this.startDate,
    this.endDate,
    required this.active,
  });
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['user_sub'] = Variable<String>(userSub);
    map['id'] = Variable<int>(id);
    map['company_id'] = Variable<int>(companyId);
    map['project_id'] = Variable<int>(projectId);
    map['unit_id'] = Variable<int>(unitId);
    map['unit_label'] = Variable<String>(unitLabel);
    if (!nullToAbsent || unitCode != null) {
      map['unit_code'] = Variable<String>(unitCode);
    }
    map['start_date'] = Variable<String>(startDate);
    if (!nullToAbsent || endDate != null) {
      map['end_date'] = Variable<String>(endDate);
    }
    map['active'] = Variable<bool>(active);
    return map;
  }

  FieldContractUnitsCompanion toCompanion(bool nullToAbsent) {
    return FieldContractUnitsCompanion(
      userSub: Value(userSub),
      id: Value(id),
      companyId: Value(companyId),
      projectId: Value(projectId),
      unitId: Value(unitId),
      unitLabel: Value(unitLabel),
      unitCode: unitCode == null && nullToAbsent
          ? const Value.absent()
          : Value(unitCode),
      startDate: Value(startDate),
      endDate: endDate == null && nullToAbsent
          ? const Value.absent()
          : Value(endDate),
      active: Value(active),
    );
  }

  factory FieldContractUnitRow.fromJson(
    Map<String, dynamic> json, {
    ValueSerializer? serializer,
  }) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return FieldContractUnitRow(
      userSub: serializer.fromJson<String>(json['userSub']),
      id: serializer.fromJson<int>(json['id']),
      companyId: serializer.fromJson<int>(json['companyId']),
      projectId: serializer.fromJson<int>(json['projectId']),
      unitId: serializer.fromJson<int>(json['unitId']),
      unitLabel: serializer.fromJson<String>(json['unitLabel']),
      unitCode: serializer.fromJson<String?>(json['unitCode']),
      startDate: serializer.fromJson<String>(json['startDate']),
      endDate: serializer.fromJson<String?>(json['endDate']),
      active: serializer.fromJson<bool>(json['active']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'userSub': serializer.toJson<String>(userSub),
      'id': serializer.toJson<int>(id),
      'companyId': serializer.toJson<int>(companyId),
      'projectId': serializer.toJson<int>(projectId),
      'unitId': serializer.toJson<int>(unitId),
      'unitLabel': serializer.toJson<String>(unitLabel),
      'unitCode': serializer.toJson<String?>(unitCode),
      'startDate': serializer.toJson<String>(startDate),
      'endDate': serializer.toJson<String?>(endDate),
      'active': serializer.toJson<bool>(active),
    };
  }

  FieldContractUnitRow copyWith({
    String? userSub,
    int? id,
    int? companyId,
    int? projectId,
    int? unitId,
    String? unitLabel,
    Value<String?> unitCode = const Value.absent(),
    String? startDate,
    Value<String?> endDate = const Value.absent(),
    bool? active,
  }) => FieldContractUnitRow(
    userSub: userSub ?? this.userSub,
    id: id ?? this.id,
    companyId: companyId ?? this.companyId,
    projectId: projectId ?? this.projectId,
    unitId: unitId ?? this.unitId,
    unitLabel: unitLabel ?? this.unitLabel,
    unitCode: unitCode.present ? unitCode.value : this.unitCode,
    startDate: startDate ?? this.startDate,
    endDate: endDate.present ? endDate.value : this.endDate,
    active: active ?? this.active,
  );
  FieldContractUnitRow copyWithCompanion(FieldContractUnitsCompanion data) {
    return FieldContractUnitRow(
      userSub: data.userSub.present ? data.userSub.value : this.userSub,
      id: data.id.present ? data.id.value : this.id,
      companyId: data.companyId.present ? data.companyId.value : this.companyId,
      projectId: data.projectId.present ? data.projectId.value : this.projectId,
      unitId: data.unitId.present ? data.unitId.value : this.unitId,
      unitLabel: data.unitLabel.present ? data.unitLabel.value : this.unitLabel,
      unitCode: data.unitCode.present ? data.unitCode.value : this.unitCode,
      startDate: data.startDate.present ? data.startDate.value : this.startDate,
      endDate: data.endDate.present ? data.endDate.value : this.endDate,
      active: data.active.present ? data.active.value : this.active,
    );
  }

  @override
  String toString() {
    return (StringBuffer('FieldContractUnitRow(')
          ..write('userSub: $userSub, ')
          ..write('id: $id, ')
          ..write('companyId: $companyId, ')
          ..write('projectId: $projectId, ')
          ..write('unitId: $unitId, ')
          ..write('unitLabel: $unitLabel, ')
          ..write('unitCode: $unitCode, ')
          ..write('startDate: $startDate, ')
          ..write('endDate: $endDate, ')
          ..write('active: $active')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(
    userSub,
    id,
    companyId,
    projectId,
    unitId,
    unitLabel,
    unitCode,
    startDate,
    endDate,
    active,
  );
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is FieldContractUnitRow &&
          other.userSub == this.userSub &&
          other.id == this.id &&
          other.companyId == this.companyId &&
          other.projectId == this.projectId &&
          other.unitId == this.unitId &&
          other.unitLabel == this.unitLabel &&
          other.unitCode == this.unitCode &&
          other.startDate == this.startDate &&
          other.endDate == this.endDate &&
          other.active == this.active);
}

class FieldContractUnitsCompanion
    extends UpdateCompanion<FieldContractUnitRow> {
  final Value<String> userSub;
  final Value<int> id;
  final Value<int> companyId;
  final Value<int> projectId;
  final Value<int> unitId;
  final Value<String> unitLabel;
  final Value<String?> unitCode;
  final Value<String> startDate;
  final Value<String?> endDate;
  final Value<bool> active;
  final Value<int> rowid;
  const FieldContractUnitsCompanion({
    this.userSub = const Value.absent(),
    this.id = const Value.absent(),
    this.companyId = const Value.absent(),
    this.projectId = const Value.absent(),
    this.unitId = const Value.absent(),
    this.unitLabel = const Value.absent(),
    this.unitCode = const Value.absent(),
    this.startDate = const Value.absent(),
    this.endDate = const Value.absent(),
    this.active = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  FieldContractUnitsCompanion.insert({
    required String userSub,
    required int id,
    required int companyId,
    required int projectId,
    required int unitId,
    this.unitLabel = const Value.absent(),
    this.unitCode = const Value.absent(),
    required String startDate,
    this.endDate = const Value.absent(),
    this.active = const Value.absent(),
    this.rowid = const Value.absent(),
  }) : userSub = Value(userSub),
       id = Value(id),
       companyId = Value(companyId),
       projectId = Value(projectId),
       unitId = Value(unitId),
       startDate = Value(startDate);
  static Insertable<FieldContractUnitRow> custom({
    Expression<String>? userSub,
    Expression<int>? id,
    Expression<int>? companyId,
    Expression<int>? projectId,
    Expression<int>? unitId,
    Expression<String>? unitLabel,
    Expression<String>? unitCode,
    Expression<String>? startDate,
    Expression<String>? endDate,
    Expression<bool>? active,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (userSub != null) 'user_sub': userSub,
      if (id != null) 'id': id,
      if (companyId != null) 'company_id': companyId,
      if (projectId != null) 'project_id': projectId,
      if (unitId != null) 'unit_id': unitId,
      if (unitLabel != null) 'unit_label': unitLabel,
      if (unitCode != null) 'unit_code': unitCode,
      if (startDate != null) 'start_date': startDate,
      if (endDate != null) 'end_date': endDate,
      if (active != null) 'active': active,
      if (rowid != null) 'rowid': rowid,
    });
  }

  FieldContractUnitsCompanion copyWith({
    Value<String>? userSub,
    Value<int>? id,
    Value<int>? companyId,
    Value<int>? projectId,
    Value<int>? unitId,
    Value<String>? unitLabel,
    Value<String?>? unitCode,
    Value<String>? startDate,
    Value<String?>? endDate,
    Value<bool>? active,
    Value<int>? rowid,
  }) {
    return FieldContractUnitsCompanion(
      userSub: userSub ?? this.userSub,
      id: id ?? this.id,
      companyId: companyId ?? this.companyId,
      projectId: projectId ?? this.projectId,
      unitId: unitId ?? this.unitId,
      unitLabel: unitLabel ?? this.unitLabel,
      unitCode: unitCode ?? this.unitCode,
      startDate: startDate ?? this.startDate,
      endDate: endDate ?? this.endDate,
      active: active ?? this.active,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (userSub.present) {
      map['user_sub'] = Variable<String>(userSub.value);
    }
    if (id.present) {
      map['id'] = Variable<int>(id.value);
    }
    if (companyId.present) {
      map['company_id'] = Variable<int>(companyId.value);
    }
    if (projectId.present) {
      map['project_id'] = Variable<int>(projectId.value);
    }
    if (unitId.present) {
      map['unit_id'] = Variable<int>(unitId.value);
    }
    if (unitLabel.present) {
      map['unit_label'] = Variable<String>(unitLabel.value);
    }
    if (unitCode.present) {
      map['unit_code'] = Variable<String>(unitCode.value);
    }
    if (startDate.present) {
      map['start_date'] = Variable<String>(startDate.value);
    }
    if (endDate.present) {
      map['end_date'] = Variable<String>(endDate.value);
    }
    if (active.present) {
      map['active'] = Variable<bool>(active.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('FieldContractUnitsCompanion(')
          ..write('userSub: $userSub, ')
          ..write('id: $id, ')
          ..write('companyId: $companyId, ')
          ..write('projectId: $projectId, ')
          ..write('unitId: $unitId, ')
          ..write('unitLabel: $unitLabel, ')
          ..write('unitCode: $unitCode, ')
          ..write('startDate: $startDate, ')
          ..write('endDate: $endDate, ')
          ..write('active: $active, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

class $FieldOpenPosTable extends FieldOpenPos
    with TableInfo<$FieldOpenPosTable, FieldOpenPoRow> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $FieldOpenPosTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _userSubMeta = const VerificationMeta(
    'userSub',
  );
  @override
  late final GeneratedColumn<String> userSub = GeneratedColumn<String>(
    'user_sub',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _idMeta = const VerificationMeta('id');
  @override
  late final GeneratedColumn<int> id = GeneratedColumn<int>(
    'id',
    aliasedName,
    false,
    type: DriftSqlType.int,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _companyIdMeta = const VerificationMeta(
    'companyId',
  );
  @override
  late final GeneratedColumn<int> companyId = GeneratedColumn<int>(
    'company_id',
    aliasedName,
    false,
    type: DriftSqlType.int,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _projectIdMeta = const VerificationMeta(
    'projectId',
  );
  @override
  late final GeneratedColumn<int> projectId = GeneratedColumn<int>(
    'project_id',
    aliasedName,
    false,
    type: DriftSqlType.int,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _clientIdMeta = const VerificationMeta(
    'clientId',
  );
  @override
  late final GeneratedColumn<int> clientId = GeneratedColumn<int>(
    'client_id',
    aliasedName,
    false,
    type: DriftSqlType.int,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _clientNameMeta = const VerificationMeta(
    'clientName',
  );
  @override
  late final GeneratedColumn<String> clientName = GeneratedColumn<String>(
    'client_name',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
    defaultValue: const Constant(''),
  );
  static const VerificationMeta _activityDateMeta = const VerificationMeta(
    'activityDate',
  );
  @override
  late final GeneratedColumn<String> activityDate = GeneratedColumn<String>(
    'activity_date',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _docNoMeta = const VerificationMeta('docNo');
  @override
  late final GeneratedColumn<String> docNo = GeneratedColumn<String>(
    'doc_no',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _itemsJsonMeta = const VerificationMeta(
    'itemsJson',
  );
  @override
  late final GeneratedColumn<String> itemsJson = GeneratedColumn<String>(
    'items_json',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
    defaultValue: const Constant('[]'),
  );
  static const VerificationMeta _poStatusMeta = const VerificationMeta(
    'poStatus',
  );
  @override
  late final GeneratedColumn<String> poStatus = GeneratedColumn<String>(
    'po_status',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
    defaultValue: const Constant('belum_kirim'),
  );
  static const VerificationMeta _ageDaysMeta = const VerificationMeta(
    'ageDays',
  );
  @override
  late final GeneratedColumn<int> ageDays = GeneratedColumn<int>(
    'age_days',
    aliasedName,
    false,
    type: DriftSqlType.int,
    requiredDuringInsert: false,
    defaultValue: const Constant(0),
  );
  static const VerificationMeta _deliveriesMeta = const VerificationMeta(
    'deliveries',
  );
  @override
  late final GeneratedColumn<int> deliveries = GeneratedColumn<int>(
    'deliveries',
    aliasedName,
    false,
    type: DriftSqlType.int,
    requiredDuringInsert: false,
    defaultValue: const Constant(0),
  );
  @override
  List<GeneratedColumn> get $columns => [
    userSub,
    id,
    companyId,
    projectId,
    clientId,
    clientName,
    activityDate,
    docNo,
    itemsJson,
    poStatus,
    ageDays,
    deliveries,
  ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'field_open_pos';
  @override
  VerificationContext validateIntegrity(
    Insertable<FieldOpenPoRow> instance, {
    bool isInserting = false,
  }) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('user_sub')) {
      context.handle(
        _userSubMeta,
        userSub.isAcceptableOrUnknown(data['user_sub']!, _userSubMeta),
      );
    } else if (isInserting) {
      context.missing(_userSubMeta);
    }
    if (data.containsKey('id')) {
      context.handle(_idMeta, id.isAcceptableOrUnknown(data['id']!, _idMeta));
    } else if (isInserting) {
      context.missing(_idMeta);
    }
    if (data.containsKey('company_id')) {
      context.handle(
        _companyIdMeta,
        companyId.isAcceptableOrUnknown(data['company_id']!, _companyIdMeta),
      );
    } else if (isInserting) {
      context.missing(_companyIdMeta);
    }
    if (data.containsKey('project_id')) {
      context.handle(
        _projectIdMeta,
        projectId.isAcceptableOrUnknown(data['project_id']!, _projectIdMeta),
      );
    } else if (isInserting) {
      context.missing(_projectIdMeta);
    }
    if (data.containsKey('client_id')) {
      context.handle(
        _clientIdMeta,
        clientId.isAcceptableOrUnknown(data['client_id']!, _clientIdMeta),
      );
    } else if (isInserting) {
      context.missing(_clientIdMeta);
    }
    if (data.containsKey('client_name')) {
      context.handle(
        _clientNameMeta,
        clientName.isAcceptableOrUnknown(data['client_name']!, _clientNameMeta),
      );
    }
    if (data.containsKey('activity_date')) {
      context.handle(
        _activityDateMeta,
        activityDate.isAcceptableOrUnknown(
          data['activity_date']!,
          _activityDateMeta,
        ),
      );
    } else if (isInserting) {
      context.missing(_activityDateMeta);
    }
    if (data.containsKey('doc_no')) {
      context.handle(
        _docNoMeta,
        docNo.isAcceptableOrUnknown(data['doc_no']!, _docNoMeta),
      );
    }
    if (data.containsKey('items_json')) {
      context.handle(
        _itemsJsonMeta,
        itemsJson.isAcceptableOrUnknown(data['items_json']!, _itemsJsonMeta),
      );
    }
    if (data.containsKey('po_status')) {
      context.handle(
        _poStatusMeta,
        poStatus.isAcceptableOrUnknown(data['po_status']!, _poStatusMeta),
      );
    }
    if (data.containsKey('age_days')) {
      context.handle(
        _ageDaysMeta,
        ageDays.isAcceptableOrUnknown(data['age_days']!, _ageDaysMeta),
      );
    }
    if (data.containsKey('deliveries')) {
      context.handle(
        _deliveriesMeta,
        deliveries.isAcceptableOrUnknown(data['deliveries']!, _deliveriesMeta),
      );
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {userSub, id};
  @override
  FieldOpenPoRow map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return FieldOpenPoRow(
      userSub: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}user_sub'],
      )!,
      id: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}id'],
      )!,
      companyId: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}company_id'],
      )!,
      projectId: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}project_id'],
      )!,
      clientId: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}client_id'],
      )!,
      clientName: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}client_name'],
      )!,
      activityDate: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}activity_date'],
      )!,
      docNo: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}doc_no'],
      ),
      itemsJson: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}items_json'],
      )!,
      poStatus: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}po_status'],
      )!,
      ageDays: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}age_days'],
      )!,
      deliveries: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}deliveries'],
      )!,
    );
  }

  @override
  $FieldOpenPosTable createAlias(String alias) {
    return $FieldOpenPosTable(attachedDatabase, alias);
  }
}

class FieldOpenPoRow extends DataClass implements Insertable<FieldOpenPoRow> {
  final String userSub;
  final int id;
  final int companyId;
  final int projectId;
  final int clientId;
  final String clientName;
  final String activityDate;
  final String? docNo;
  final String itemsJson;
  final String poStatus;
  final int ageDays;
  final int deliveries;
  const FieldOpenPoRow({
    required this.userSub,
    required this.id,
    required this.companyId,
    required this.projectId,
    required this.clientId,
    required this.clientName,
    required this.activityDate,
    this.docNo,
    required this.itemsJson,
    required this.poStatus,
    required this.ageDays,
    required this.deliveries,
  });
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['user_sub'] = Variable<String>(userSub);
    map['id'] = Variable<int>(id);
    map['company_id'] = Variable<int>(companyId);
    map['project_id'] = Variable<int>(projectId);
    map['client_id'] = Variable<int>(clientId);
    map['client_name'] = Variable<String>(clientName);
    map['activity_date'] = Variable<String>(activityDate);
    if (!nullToAbsent || docNo != null) {
      map['doc_no'] = Variable<String>(docNo);
    }
    map['items_json'] = Variable<String>(itemsJson);
    map['po_status'] = Variable<String>(poStatus);
    map['age_days'] = Variable<int>(ageDays);
    map['deliveries'] = Variable<int>(deliveries);
    return map;
  }

  FieldOpenPosCompanion toCompanion(bool nullToAbsent) {
    return FieldOpenPosCompanion(
      userSub: Value(userSub),
      id: Value(id),
      companyId: Value(companyId),
      projectId: Value(projectId),
      clientId: Value(clientId),
      clientName: Value(clientName),
      activityDate: Value(activityDate),
      docNo: docNo == null && nullToAbsent
          ? const Value.absent()
          : Value(docNo),
      itemsJson: Value(itemsJson),
      poStatus: Value(poStatus),
      ageDays: Value(ageDays),
      deliveries: Value(deliveries),
    );
  }

  factory FieldOpenPoRow.fromJson(
    Map<String, dynamic> json, {
    ValueSerializer? serializer,
  }) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return FieldOpenPoRow(
      userSub: serializer.fromJson<String>(json['userSub']),
      id: serializer.fromJson<int>(json['id']),
      companyId: serializer.fromJson<int>(json['companyId']),
      projectId: serializer.fromJson<int>(json['projectId']),
      clientId: serializer.fromJson<int>(json['clientId']),
      clientName: serializer.fromJson<String>(json['clientName']),
      activityDate: serializer.fromJson<String>(json['activityDate']),
      docNo: serializer.fromJson<String?>(json['docNo']),
      itemsJson: serializer.fromJson<String>(json['itemsJson']),
      poStatus: serializer.fromJson<String>(json['poStatus']),
      ageDays: serializer.fromJson<int>(json['ageDays']),
      deliveries: serializer.fromJson<int>(json['deliveries']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'userSub': serializer.toJson<String>(userSub),
      'id': serializer.toJson<int>(id),
      'companyId': serializer.toJson<int>(companyId),
      'projectId': serializer.toJson<int>(projectId),
      'clientId': serializer.toJson<int>(clientId),
      'clientName': serializer.toJson<String>(clientName),
      'activityDate': serializer.toJson<String>(activityDate),
      'docNo': serializer.toJson<String?>(docNo),
      'itemsJson': serializer.toJson<String>(itemsJson),
      'poStatus': serializer.toJson<String>(poStatus),
      'ageDays': serializer.toJson<int>(ageDays),
      'deliveries': serializer.toJson<int>(deliveries),
    };
  }

  FieldOpenPoRow copyWith({
    String? userSub,
    int? id,
    int? companyId,
    int? projectId,
    int? clientId,
    String? clientName,
    String? activityDate,
    Value<String?> docNo = const Value.absent(),
    String? itemsJson,
    String? poStatus,
    int? ageDays,
    int? deliveries,
  }) => FieldOpenPoRow(
    userSub: userSub ?? this.userSub,
    id: id ?? this.id,
    companyId: companyId ?? this.companyId,
    projectId: projectId ?? this.projectId,
    clientId: clientId ?? this.clientId,
    clientName: clientName ?? this.clientName,
    activityDate: activityDate ?? this.activityDate,
    docNo: docNo.present ? docNo.value : this.docNo,
    itemsJson: itemsJson ?? this.itemsJson,
    poStatus: poStatus ?? this.poStatus,
    ageDays: ageDays ?? this.ageDays,
    deliveries: deliveries ?? this.deliveries,
  );
  FieldOpenPoRow copyWithCompanion(FieldOpenPosCompanion data) {
    return FieldOpenPoRow(
      userSub: data.userSub.present ? data.userSub.value : this.userSub,
      id: data.id.present ? data.id.value : this.id,
      companyId: data.companyId.present ? data.companyId.value : this.companyId,
      projectId: data.projectId.present ? data.projectId.value : this.projectId,
      clientId: data.clientId.present ? data.clientId.value : this.clientId,
      clientName: data.clientName.present
          ? data.clientName.value
          : this.clientName,
      activityDate: data.activityDate.present
          ? data.activityDate.value
          : this.activityDate,
      docNo: data.docNo.present ? data.docNo.value : this.docNo,
      itemsJson: data.itemsJson.present ? data.itemsJson.value : this.itemsJson,
      poStatus: data.poStatus.present ? data.poStatus.value : this.poStatus,
      ageDays: data.ageDays.present ? data.ageDays.value : this.ageDays,
      deliveries: data.deliveries.present
          ? data.deliveries.value
          : this.deliveries,
    );
  }

  @override
  String toString() {
    return (StringBuffer('FieldOpenPoRow(')
          ..write('userSub: $userSub, ')
          ..write('id: $id, ')
          ..write('companyId: $companyId, ')
          ..write('projectId: $projectId, ')
          ..write('clientId: $clientId, ')
          ..write('clientName: $clientName, ')
          ..write('activityDate: $activityDate, ')
          ..write('docNo: $docNo, ')
          ..write('itemsJson: $itemsJson, ')
          ..write('poStatus: $poStatus, ')
          ..write('ageDays: $ageDays, ')
          ..write('deliveries: $deliveries')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(
    userSub,
    id,
    companyId,
    projectId,
    clientId,
    clientName,
    activityDate,
    docNo,
    itemsJson,
    poStatus,
    ageDays,
    deliveries,
  );
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is FieldOpenPoRow &&
          other.userSub == this.userSub &&
          other.id == this.id &&
          other.companyId == this.companyId &&
          other.projectId == this.projectId &&
          other.clientId == this.clientId &&
          other.clientName == this.clientName &&
          other.activityDate == this.activityDate &&
          other.docNo == this.docNo &&
          other.itemsJson == this.itemsJson &&
          other.poStatus == this.poStatus &&
          other.ageDays == this.ageDays &&
          other.deliveries == this.deliveries);
}

class FieldOpenPosCompanion extends UpdateCompanion<FieldOpenPoRow> {
  final Value<String> userSub;
  final Value<int> id;
  final Value<int> companyId;
  final Value<int> projectId;
  final Value<int> clientId;
  final Value<String> clientName;
  final Value<String> activityDate;
  final Value<String?> docNo;
  final Value<String> itemsJson;
  final Value<String> poStatus;
  final Value<int> ageDays;
  final Value<int> deliveries;
  final Value<int> rowid;
  const FieldOpenPosCompanion({
    this.userSub = const Value.absent(),
    this.id = const Value.absent(),
    this.companyId = const Value.absent(),
    this.projectId = const Value.absent(),
    this.clientId = const Value.absent(),
    this.clientName = const Value.absent(),
    this.activityDate = const Value.absent(),
    this.docNo = const Value.absent(),
    this.itemsJson = const Value.absent(),
    this.poStatus = const Value.absent(),
    this.ageDays = const Value.absent(),
    this.deliveries = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  FieldOpenPosCompanion.insert({
    required String userSub,
    required int id,
    required int companyId,
    required int projectId,
    required int clientId,
    this.clientName = const Value.absent(),
    required String activityDate,
    this.docNo = const Value.absent(),
    this.itemsJson = const Value.absent(),
    this.poStatus = const Value.absent(),
    this.ageDays = const Value.absent(),
    this.deliveries = const Value.absent(),
    this.rowid = const Value.absent(),
  }) : userSub = Value(userSub),
       id = Value(id),
       companyId = Value(companyId),
       projectId = Value(projectId),
       clientId = Value(clientId),
       activityDate = Value(activityDate);
  static Insertable<FieldOpenPoRow> custom({
    Expression<String>? userSub,
    Expression<int>? id,
    Expression<int>? companyId,
    Expression<int>? projectId,
    Expression<int>? clientId,
    Expression<String>? clientName,
    Expression<String>? activityDate,
    Expression<String>? docNo,
    Expression<String>? itemsJson,
    Expression<String>? poStatus,
    Expression<int>? ageDays,
    Expression<int>? deliveries,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (userSub != null) 'user_sub': userSub,
      if (id != null) 'id': id,
      if (companyId != null) 'company_id': companyId,
      if (projectId != null) 'project_id': projectId,
      if (clientId != null) 'client_id': clientId,
      if (clientName != null) 'client_name': clientName,
      if (activityDate != null) 'activity_date': activityDate,
      if (docNo != null) 'doc_no': docNo,
      if (itemsJson != null) 'items_json': itemsJson,
      if (poStatus != null) 'po_status': poStatus,
      if (ageDays != null) 'age_days': ageDays,
      if (deliveries != null) 'deliveries': deliveries,
      if (rowid != null) 'rowid': rowid,
    });
  }

  FieldOpenPosCompanion copyWith({
    Value<String>? userSub,
    Value<int>? id,
    Value<int>? companyId,
    Value<int>? projectId,
    Value<int>? clientId,
    Value<String>? clientName,
    Value<String>? activityDate,
    Value<String?>? docNo,
    Value<String>? itemsJson,
    Value<String>? poStatus,
    Value<int>? ageDays,
    Value<int>? deliveries,
    Value<int>? rowid,
  }) {
    return FieldOpenPosCompanion(
      userSub: userSub ?? this.userSub,
      id: id ?? this.id,
      companyId: companyId ?? this.companyId,
      projectId: projectId ?? this.projectId,
      clientId: clientId ?? this.clientId,
      clientName: clientName ?? this.clientName,
      activityDate: activityDate ?? this.activityDate,
      docNo: docNo ?? this.docNo,
      itemsJson: itemsJson ?? this.itemsJson,
      poStatus: poStatus ?? this.poStatus,
      ageDays: ageDays ?? this.ageDays,
      deliveries: deliveries ?? this.deliveries,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (userSub.present) {
      map['user_sub'] = Variable<String>(userSub.value);
    }
    if (id.present) {
      map['id'] = Variable<int>(id.value);
    }
    if (companyId.present) {
      map['company_id'] = Variable<int>(companyId.value);
    }
    if (projectId.present) {
      map['project_id'] = Variable<int>(projectId.value);
    }
    if (clientId.present) {
      map['client_id'] = Variable<int>(clientId.value);
    }
    if (clientName.present) {
      map['client_name'] = Variable<String>(clientName.value);
    }
    if (activityDate.present) {
      map['activity_date'] = Variable<String>(activityDate.value);
    }
    if (docNo.present) {
      map['doc_no'] = Variable<String>(docNo.value);
    }
    if (itemsJson.present) {
      map['items_json'] = Variable<String>(itemsJson.value);
    }
    if (poStatus.present) {
      map['po_status'] = Variable<String>(poStatus.value);
    }
    if (ageDays.present) {
      map['age_days'] = Variable<int>(ageDays.value);
    }
    if (deliveries.present) {
      map['deliveries'] = Variable<int>(deliveries.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('FieldOpenPosCompanion(')
          ..write('userSub: $userSub, ')
          ..write('id: $id, ')
          ..write('companyId: $companyId, ')
          ..write('projectId: $projectId, ')
          ..write('clientId: $clientId, ')
          ..write('clientName: $clientName, ')
          ..write('activityDate: $activityDate, ')
          ..write('docNo: $docNo, ')
          ..write('itemsJson: $itemsJson, ')
          ..write('poStatus: $poStatus, ')
          ..write('ageDays: $ageDays, ')
          ..write('deliveries: $deliveries, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

class $FieldClientsTable extends FieldClients
    with TableInfo<$FieldClientsTable, FieldClientRow> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $FieldClientsTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _userSubMeta = const VerificationMeta(
    'userSub',
  );
  @override
  late final GeneratedColumn<String> userSub = GeneratedColumn<String>(
    'user_sub',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _idMeta = const VerificationMeta('id');
  @override
  late final GeneratedColumn<int> id = GeneratedColumn<int>(
    'id',
    aliasedName,
    false,
    type: DriftSqlType.int,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _companyIdMeta = const VerificationMeta(
    'companyId',
  );
  @override
  late final GeneratedColumn<int> companyId = GeneratedColumn<int>(
    'company_id',
    aliasedName,
    false,
    type: DriftSqlType.int,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _nameMeta = const VerificationMeta('name');
  @override
  late final GeneratedColumn<String> name = GeneratedColumn<String>(
    'name',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
    defaultValue: const Constant(''),
  );
  @override
  List<GeneratedColumn> get $columns => [userSub, id, companyId, name];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'field_clients';
  @override
  VerificationContext validateIntegrity(
    Insertable<FieldClientRow> instance, {
    bool isInserting = false,
  }) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('user_sub')) {
      context.handle(
        _userSubMeta,
        userSub.isAcceptableOrUnknown(data['user_sub']!, _userSubMeta),
      );
    } else if (isInserting) {
      context.missing(_userSubMeta);
    }
    if (data.containsKey('id')) {
      context.handle(_idMeta, id.isAcceptableOrUnknown(data['id']!, _idMeta));
    } else if (isInserting) {
      context.missing(_idMeta);
    }
    if (data.containsKey('company_id')) {
      context.handle(
        _companyIdMeta,
        companyId.isAcceptableOrUnknown(data['company_id']!, _companyIdMeta),
      );
    } else if (isInserting) {
      context.missing(_companyIdMeta);
    }
    if (data.containsKey('name')) {
      context.handle(
        _nameMeta,
        name.isAcceptableOrUnknown(data['name']!, _nameMeta),
      );
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {userSub, id};
  @override
  FieldClientRow map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return FieldClientRow(
      userSub: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}user_sub'],
      )!,
      id: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}id'],
      )!,
      companyId: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}company_id'],
      )!,
      name: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}name'],
      )!,
    );
  }

  @override
  $FieldClientsTable createAlias(String alias) {
    return $FieldClientsTable(attachedDatabase, alias);
  }
}

class FieldClientRow extends DataClass implements Insertable<FieldClientRow> {
  final String userSub;
  final int id;
  final int companyId;
  final String name;
  const FieldClientRow({
    required this.userSub,
    required this.id,
    required this.companyId,
    required this.name,
  });
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['user_sub'] = Variable<String>(userSub);
    map['id'] = Variable<int>(id);
    map['company_id'] = Variable<int>(companyId);
    map['name'] = Variable<String>(name);
    return map;
  }

  FieldClientsCompanion toCompanion(bool nullToAbsent) {
    return FieldClientsCompanion(
      userSub: Value(userSub),
      id: Value(id),
      companyId: Value(companyId),
      name: Value(name),
    );
  }

  factory FieldClientRow.fromJson(
    Map<String, dynamic> json, {
    ValueSerializer? serializer,
  }) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return FieldClientRow(
      userSub: serializer.fromJson<String>(json['userSub']),
      id: serializer.fromJson<int>(json['id']),
      companyId: serializer.fromJson<int>(json['companyId']),
      name: serializer.fromJson<String>(json['name']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'userSub': serializer.toJson<String>(userSub),
      'id': serializer.toJson<int>(id),
      'companyId': serializer.toJson<int>(companyId),
      'name': serializer.toJson<String>(name),
    };
  }

  FieldClientRow copyWith({
    String? userSub,
    int? id,
    int? companyId,
    String? name,
  }) => FieldClientRow(
    userSub: userSub ?? this.userSub,
    id: id ?? this.id,
    companyId: companyId ?? this.companyId,
    name: name ?? this.name,
  );
  FieldClientRow copyWithCompanion(FieldClientsCompanion data) {
    return FieldClientRow(
      userSub: data.userSub.present ? data.userSub.value : this.userSub,
      id: data.id.present ? data.id.value : this.id,
      companyId: data.companyId.present ? data.companyId.value : this.companyId,
      name: data.name.present ? data.name.value : this.name,
    );
  }

  @override
  String toString() {
    return (StringBuffer('FieldClientRow(')
          ..write('userSub: $userSub, ')
          ..write('id: $id, ')
          ..write('companyId: $companyId, ')
          ..write('name: $name')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(userSub, id, companyId, name);
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is FieldClientRow &&
          other.userSub == this.userSub &&
          other.id == this.id &&
          other.companyId == this.companyId &&
          other.name == this.name);
}

class FieldClientsCompanion extends UpdateCompanion<FieldClientRow> {
  final Value<String> userSub;
  final Value<int> id;
  final Value<int> companyId;
  final Value<String> name;
  final Value<int> rowid;
  const FieldClientsCompanion({
    this.userSub = const Value.absent(),
    this.id = const Value.absent(),
    this.companyId = const Value.absent(),
    this.name = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  FieldClientsCompanion.insert({
    required String userSub,
    required int id,
    required int companyId,
    this.name = const Value.absent(),
    this.rowid = const Value.absent(),
  }) : userSub = Value(userSub),
       id = Value(id),
       companyId = Value(companyId);
  static Insertable<FieldClientRow> custom({
    Expression<String>? userSub,
    Expression<int>? id,
    Expression<int>? companyId,
    Expression<String>? name,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (userSub != null) 'user_sub': userSub,
      if (id != null) 'id': id,
      if (companyId != null) 'company_id': companyId,
      if (name != null) 'name': name,
      if (rowid != null) 'rowid': rowid,
    });
  }

  FieldClientsCompanion copyWith({
    Value<String>? userSub,
    Value<int>? id,
    Value<int>? companyId,
    Value<String>? name,
    Value<int>? rowid,
  }) {
    return FieldClientsCompanion(
      userSub: userSub ?? this.userSub,
      id: id ?? this.id,
      companyId: companyId ?? this.companyId,
      name: name ?? this.name,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (userSub.present) {
      map['user_sub'] = Variable<String>(userSub.value);
    }
    if (id.present) {
      map['id'] = Variable<int>(id.value);
    }
    if (companyId.present) {
      map['company_id'] = Variable<int>(companyId.value);
    }
    if (name.present) {
      map['name'] = Variable<String>(name.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('FieldClientsCompanion(')
          ..write('userSub: $userSub, ')
          ..write('id: $id, ')
          ..write('companyId: $companyId, ')
          ..write('name: $name, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

class $FieldRecentTimesheetsTable extends FieldRecentTimesheets
    with TableInfo<$FieldRecentTimesheetsTable, FieldRecentTimesheetRow> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $FieldRecentTimesheetsTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _userSubMeta = const VerificationMeta(
    'userSub',
  );
  @override
  late final GeneratedColumn<String> userSub = GeneratedColumn<String>(
    'user_sub',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _idMeta = const VerificationMeta('id');
  @override
  late final GeneratedColumn<int> id = GeneratedColumn<int>(
    'id',
    aliasedName,
    false,
    type: DriftSqlType.int,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _companyIdMeta = const VerificationMeta(
    'companyId',
  );
  @override
  late final GeneratedColumn<int> companyId = GeneratedColumn<int>(
    'company_id',
    aliasedName,
    false,
    type: DriftSqlType.int,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _projectIdMeta = const VerificationMeta(
    'projectId',
  );
  @override
  late final GeneratedColumn<int> projectId = GeneratedColumn<int>(
    'project_id',
    aliasedName,
    false,
    type: DriftSqlType.int,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _unitIdMeta = const VerificationMeta('unitId');
  @override
  late final GeneratedColumn<int> unitId = GeneratedColumn<int>(
    'unit_id',
    aliasedName,
    false,
    type: DriftSqlType.int,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _reportDateMeta = const VerificationMeta(
    'reportDate',
  );
  @override
  late final GeneratedColumn<String> reportDate = GeneratedColumn<String>(
    'report_date',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _hmStartMeta = const VerificationMeta(
    'hmStart',
  );
  @override
  late final GeneratedColumn<double> hmStart = GeneratedColumn<double>(
    'hm_start',
    aliasedName,
    true,
    type: DriftSqlType.double,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _hmEndMeta = const VerificationMeta('hmEnd');
  @override
  late final GeneratedColumn<double> hmEnd = GeneratedColumn<double>(
    'hm_end',
    aliasedName,
    true,
    type: DriftSqlType.double,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _operatorNameMeta = const VerificationMeta(
    'operatorName',
  );
  @override
  late final GeneratedColumn<String> operatorName = GeneratedColumn<String>(
    'operator_name',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _locationMeta = const VerificationMeta(
    'location',
  );
  @override
  late final GeneratedColumn<String> location = GeneratedColumn<String>(
    'location',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _fuelLitersMeta = const VerificationMeta(
    'fuelLiters',
  );
  @override
  late final GeneratedColumn<double> fuelLiters = GeneratedColumn<double>(
    'fuel_liters',
    aliasedName,
    true,
    type: DriftSqlType.double,
    requiredDuringInsert: false,
  );
  @override
  List<GeneratedColumn> get $columns => [
    userSub,
    id,
    companyId,
    projectId,
    unitId,
    reportDate,
    hmStart,
    hmEnd,
    operatorName,
    location,
    fuelLiters,
  ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'field_recent_timesheets';
  @override
  VerificationContext validateIntegrity(
    Insertable<FieldRecentTimesheetRow> instance, {
    bool isInserting = false,
  }) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('user_sub')) {
      context.handle(
        _userSubMeta,
        userSub.isAcceptableOrUnknown(data['user_sub']!, _userSubMeta),
      );
    } else if (isInserting) {
      context.missing(_userSubMeta);
    }
    if (data.containsKey('id')) {
      context.handle(_idMeta, id.isAcceptableOrUnknown(data['id']!, _idMeta));
    } else if (isInserting) {
      context.missing(_idMeta);
    }
    if (data.containsKey('company_id')) {
      context.handle(
        _companyIdMeta,
        companyId.isAcceptableOrUnknown(data['company_id']!, _companyIdMeta),
      );
    } else if (isInserting) {
      context.missing(_companyIdMeta);
    }
    if (data.containsKey('project_id')) {
      context.handle(
        _projectIdMeta,
        projectId.isAcceptableOrUnknown(data['project_id']!, _projectIdMeta),
      );
    } else if (isInserting) {
      context.missing(_projectIdMeta);
    }
    if (data.containsKey('unit_id')) {
      context.handle(
        _unitIdMeta,
        unitId.isAcceptableOrUnknown(data['unit_id']!, _unitIdMeta),
      );
    } else if (isInserting) {
      context.missing(_unitIdMeta);
    }
    if (data.containsKey('report_date')) {
      context.handle(
        _reportDateMeta,
        reportDate.isAcceptableOrUnknown(data['report_date']!, _reportDateMeta),
      );
    } else if (isInserting) {
      context.missing(_reportDateMeta);
    }
    if (data.containsKey('hm_start')) {
      context.handle(
        _hmStartMeta,
        hmStart.isAcceptableOrUnknown(data['hm_start']!, _hmStartMeta),
      );
    }
    if (data.containsKey('hm_end')) {
      context.handle(
        _hmEndMeta,
        hmEnd.isAcceptableOrUnknown(data['hm_end']!, _hmEndMeta),
      );
    }
    if (data.containsKey('operator_name')) {
      context.handle(
        _operatorNameMeta,
        operatorName.isAcceptableOrUnknown(
          data['operator_name']!,
          _operatorNameMeta,
        ),
      );
    }
    if (data.containsKey('location')) {
      context.handle(
        _locationMeta,
        location.isAcceptableOrUnknown(data['location']!, _locationMeta),
      );
    }
    if (data.containsKey('fuel_liters')) {
      context.handle(
        _fuelLitersMeta,
        fuelLiters.isAcceptableOrUnknown(data['fuel_liters']!, _fuelLitersMeta),
      );
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {userSub, id};
  @override
  FieldRecentTimesheetRow map(
    Map<String, dynamic> data, {
    String? tablePrefix,
  }) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return FieldRecentTimesheetRow(
      userSub: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}user_sub'],
      )!,
      id: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}id'],
      )!,
      companyId: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}company_id'],
      )!,
      projectId: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}project_id'],
      )!,
      unitId: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}unit_id'],
      )!,
      reportDate: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}report_date'],
      )!,
      hmStart: attachedDatabase.typeMapping.read(
        DriftSqlType.double,
        data['${effectivePrefix}hm_start'],
      ),
      hmEnd: attachedDatabase.typeMapping.read(
        DriftSqlType.double,
        data['${effectivePrefix}hm_end'],
      ),
      operatorName: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}operator_name'],
      ),
      location: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}location'],
      ),
      fuelLiters: attachedDatabase.typeMapping.read(
        DriftSqlType.double,
        data['${effectivePrefix}fuel_liters'],
      ),
    );
  }

  @override
  $FieldRecentTimesheetsTable createAlias(String alias) {
    return $FieldRecentTimesheetsTable(attachedDatabase, alias);
  }
}

class FieldRecentTimesheetRow extends DataClass
    implements Insertable<FieldRecentTimesheetRow> {
  final String userSub;
  final int id;
  final int companyId;
  final int projectId;
  final int unitId;
  final String reportDate;
  final double? hmStart;
  final double? hmEnd;
  final String? operatorName;
  final String? location;
  final double? fuelLiters;
  const FieldRecentTimesheetRow({
    required this.userSub,
    required this.id,
    required this.companyId,
    required this.projectId,
    required this.unitId,
    required this.reportDate,
    this.hmStart,
    this.hmEnd,
    this.operatorName,
    this.location,
    this.fuelLiters,
  });
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['user_sub'] = Variable<String>(userSub);
    map['id'] = Variable<int>(id);
    map['company_id'] = Variable<int>(companyId);
    map['project_id'] = Variable<int>(projectId);
    map['unit_id'] = Variable<int>(unitId);
    map['report_date'] = Variable<String>(reportDate);
    if (!nullToAbsent || hmStart != null) {
      map['hm_start'] = Variable<double>(hmStart);
    }
    if (!nullToAbsent || hmEnd != null) {
      map['hm_end'] = Variable<double>(hmEnd);
    }
    if (!nullToAbsent || operatorName != null) {
      map['operator_name'] = Variable<String>(operatorName);
    }
    if (!nullToAbsent || location != null) {
      map['location'] = Variable<String>(location);
    }
    if (!nullToAbsent || fuelLiters != null) {
      map['fuel_liters'] = Variable<double>(fuelLiters);
    }
    return map;
  }

  FieldRecentTimesheetsCompanion toCompanion(bool nullToAbsent) {
    return FieldRecentTimesheetsCompanion(
      userSub: Value(userSub),
      id: Value(id),
      companyId: Value(companyId),
      projectId: Value(projectId),
      unitId: Value(unitId),
      reportDate: Value(reportDate),
      hmStart: hmStart == null && nullToAbsent
          ? const Value.absent()
          : Value(hmStart),
      hmEnd: hmEnd == null && nullToAbsent
          ? const Value.absent()
          : Value(hmEnd),
      operatorName: operatorName == null && nullToAbsent
          ? const Value.absent()
          : Value(operatorName),
      location: location == null && nullToAbsent
          ? const Value.absent()
          : Value(location),
      fuelLiters: fuelLiters == null && nullToAbsent
          ? const Value.absent()
          : Value(fuelLiters),
    );
  }

  factory FieldRecentTimesheetRow.fromJson(
    Map<String, dynamic> json, {
    ValueSerializer? serializer,
  }) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return FieldRecentTimesheetRow(
      userSub: serializer.fromJson<String>(json['userSub']),
      id: serializer.fromJson<int>(json['id']),
      companyId: serializer.fromJson<int>(json['companyId']),
      projectId: serializer.fromJson<int>(json['projectId']),
      unitId: serializer.fromJson<int>(json['unitId']),
      reportDate: serializer.fromJson<String>(json['reportDate']),
      hmStart: serializer.fromJson<double?>(json['hmStart']),
      hmEnd: serializer.fromJson<double?>(json['hmEnd']),
      operatorName: serializer.fromJson<String?>(json['operatorName']),
      location: serializer.fromJson<String?>(json['location']),
      fuelLiters: serializer.fromJson<double?>(json['fuelLiters']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'userSub': serializer.toJson<String>(userSub),
      'id': serializer.toJson<int>(id),
      'companyId': serializer.toJson<int>(companyId),
      'projectId': serializer.toJson<int>(projectId),
      'unitId': serializer.toJson<int>(unitId),
      'reportDate': serializer.toJson<String>(reportDate),
      'hmStart': serializer.toJson<double?>(hmStart),
      'hmEnd': serializer.toJson<double?>(hmEnd),
      'operatorName': serializer.toJson<String?>(operatorName),
      'location': serializer.toJson<String?>(location),
      'fuelLiters': serializer.toJson<double?>(fuelLiters),
    };
  }

  FieldRecentTimesheetRow copyWith({
    String? userSub,
    int? id,
    int? companyId,
    int? projectId,
    int? unitId,
    String? reportDate,
    Value<double?> hmStart = const Value.absent(),
    Value<double?> hmEnd = const Value.absent(),
    Value<String?> operatorName = const Value.absent(),
    Value<String?> location = const Value.absent(),
    Value<double?> fuelLiters = const Value.absent(),
  }) => FieldRecentTimesheetRow(
    userSub: userSub ?? this.userSub,
    id: id ?? this.id,
    companyId: companyId ?? this.companyId,
    projectId: projectId ?? this.projectId,
    unitId: unitId ?? this.unitId,
    reportDate: reportDate ?? this.reportDate,
    hmStart: hmStart.present ? hmStart.value : this.hmStart,
    hmEnd: hmEnd.present ? hmEnd.value : this.hmEnd,
    operatorName: operatorName.present ? operatorName.value : this.operatorName,
    location: location.present ? location.value : this.location,
    fuelLiters: fuelLiters.present ? fuelLiters.value : this.fuelLiters,
  );
  FieldRecentTimesheetRow copyWithCompanion(
    FieldRecentTimesheetsCompanion data,
  ) {
    return FieldRecentTimesheetRow(
      userSub: data.userSub.present ? data.userSub.value : this.userSub,
      id: data.id.present ? data.id.value : this.id,
      companyId: data.companyId.present ? data.companyId.value : this.companyId,
      projectId: data.projectId.present ? data.projectId.value : this.projectId,
      unitId: data.unitId.present ? data.unitId.value : this.unitId,
      reportDate: data.reportDate.present
          ? data.reportDate.value
          : this.reportDate,
      hmStart: data.hmStart.present ? data.hmStart.value : this.hmStart,
      hmEnd: data.hmEnd.present ? data.hmEnd.value : this.hmEnd,
      operatorName: data.operatorName.present
          ? data.operatorName.value
          : this.operatorName,
      location: data.location.present ? data.location.value : this.location,
      fuelLiters: data.fuelLiters.present
          ? data.fuelLiters.value
          : this.fuelLiters,
    );
  }

  @override
  String toString() {
    return (StringBuffer('FieldRecentTimesheetRow(')
          ..write('userSub: $userSub, ')
          ..write('id: $id, ')
          ..write('companyId: $companyId, ')
          ..write('projectId: $projectId, ')
          ..write('unitId: $unitId, ')
          ..write('reportDate: $reportDate, ')
          ..write('hmStart: $hmStart, ')
          ..write('hmEnd: $hmEnd, ')
          ..write('operatorName: $operatorName, ')
          ..write('location: $location, ')
          ..write('fuelLiters: $fuelLiters')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(
    userSub,
    id,
    companyId,
    projectId,
    unitId,
    reportDate,
    hmStart,
    hmEnd,
    operatorName,
    location,
    fuelLiters,
  );
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is FieldRecentTimesheetRow &&
          other.userSub == this.userSub &&
          other.id == this.id &&
          other.companyId == this.companyId &&
          other.projectId == this.projectId &&
          other.unitId == this.unitId &&
          other.reportDate == this.reportDate &&
          other.hmStart == this.hmStart &&
          other.hmEnd == this.hmEnd &&
          other.operatorName == this.operatorName &&
          other.location == this.location &&
          other.fuelLiters == this.fuelLiters);
}

class FieldRecentTimesheetsCompanion
    extends UpdateCompanion<FieldRecentTimesheetRow> {
  final Value<String> userSub;
  final Value<int> id;
  final Value<int> companyId;
  final Value<int> projectId;
  final Value<int> unitId;
  final Value<String> reportDate;
  final Value<double?> hmStart;
  final Value<double?> hmEnd;
  final Value<String?> operatorName;
  final Value<String?> location;
  final Value<double?> fuelLiters;
  final Value<int> rowid;
  const FieldRecentTimesheetsCompanion({
    this.userSub = const Value.absent(),
    this.id = const Value.absent(),
    this.companyId = const Value.absent(),
    this.projectId = const Value.absent(),
    this.unitId = const Value.absent(),
    this.reportDate = const Value.absent(),
    this.hmStart = const Value.absent(),
    this.hmEnd = const Value.absent(),
    this.operatorName = const Value.absent(),
    this.location = const Value.absent(),
    this.fuelLiters = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  FieldRecentTimesheetsCompanion.insert({
    required String userSub,
    required int id,
    required int companyId,
    required int projectId,
    required int unitId,
    required String reportDate,
    this.hmStart = const Value.absent(),
    this.hmEnd = const Value.absent(),
    this.operatorName = const Value.absent(),
    this.location = const Value.absent(),
    this.fuelLiters = const Value.absent(),
    this.rowid = const Value.absent(),
  }) : userSub = Value(userSub),
       id = Value(id),
       companyId = Value(companyId),
       projectId = Value(projectId),
       unitId = Value(unitId),
       reportDate = Value(reportDate);
  static Insertable<FieldRecentTimesheetRow> custom({
    Expression<String>? userSub,
    Expression<int>? id,
    Expression<int>? companyId,
    Expression<int>? projectId,
    Expression<int>? unitId,
    Expression<String>? reportDate,
    Expression<double>? hmStart,
    Expression<double>? hmEnd,
    Expression<String>? operatorName,
    Expression<String>? location,
    Expression<double>? fuelLiters,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (userSub != null) 'user_sub': userSub,
      if (id != null) 'id': id,
      if (companyId != null) 'company_id': companyId,
      if (projectId != null) 'project_id': projectId,
      if (unitId != null) 'unit_id': unitId,
      if (reportDate != null) 'report_date': reportDate,
      if (hmStart != null) 'hm_start': hmStart,
      if (hmEnd != null) 'hm_end': hmEnd,
      if (operatorName != null) 'operator_name': operatorName,
      if (location != null) 'location': location,
      if (fuelLiters != null) 'fuel_liters': fuelLiters,
      if (rowid != null) 'rowid': rowid,
    });
  }

  FieldRecentTimesheetsCompanion copyWith({
    Value<String>? userSub,
    Value<int>? id,
    Value<int>? companyId,
    Value<int>? projectId,
    Value<int>? unitId,
    Value<String>? reportDate,
    Value<double?>? hmStart,
    Value<double?>? hmEnd,
    Value<String?>? operatorName,
    Value<String?>? location,
    Value<double?>? fuelLiters,
    Value<int>? rowid,
  }) {
    return FieldRecentTimesheetsCompanion(
      userSub: userSub ?? this.userSub,
      id: id ?? this.id,
      companyId: companyId ?? this.companyId,
      projectId: projectId ?? this.projectId,
      unitId: unitId ?? this.unitId,
      reportDate: reportDate ?? this.reportDate,
      hmStart: hmStart ?? this.hmStart,
      hmEnd: hmEnd ?? this.hmEnd,
      operatorName: operatorName ?? this.operatorName,
      location: location ?? this.location,
      fuelLiters: fuelLiters ?? this.fuelLiters,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (userSub.present) {
      map['user_sub'] = Variable<String>(userSub.value);
    }
    if (id.present) {
      map['id'] = Variable<int>(id.value);
    }
    if (companyId.present) {
      map['company_id'] = Variable<int>(companyId.value);
    }
    if (projectId.present) {
      map['project_id'] = Variable<int>(projectId.value);
    }
    if (unitId.present) {
      map['unit_id'] = Variable<int>(unitId.value);
    }
    if (reportDate.present) {
      map['report_date'] = Variable<String>(reportDate.value);
    }
    if (hmStart.present) {
      map['hm_start'] = Variable<double>(hmStart.value);
    }
    if (hmEnd.present) {
      map['hm_end'] = Variable<double>(hmEnd.value);
    }
    if (operatorName.present) {
      map['operator_name'] = Variable<String>(operatorName.value);
    }
    if (location.present) {
      map['location'] = Variable<String>(location.value);
    }
    if (fuelLiters.present) {
      map['fuel_liters'] = Variable<double>(fuelLiters.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('FieldRecentTimesheetsCompanion(')
          ..write('userSub: $userSub, ')
          ..write('id: $id, ')
          ..write('companyId: $companyId, ')
          ..write('projectId: $projectId, ')
          ..write('unitId: $unitId, ')
          ..write('reportDate: $reportDate, ')
          ..write('hmStart: $hmStart, ')
          ..write('hmEnd: $hmEnd, ')
          ..write('operatorName: $operatorName, ')
          ..write('location: $location, ')
          ..write('fuelLiters: $fuelLiters, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

class $FieldRapItemsTable extends FieldRapItems
    with TableInfo<$FieldRapItemsTable, FieldRapItemRow> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $FieldRapItemsTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _userSubMeta = const VerificationMeta(
    'userSub',
  );
  @override
  late final GeneratedColumn<String> userSub = GeneratedColumn<String>(
    'user_sub',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _idMeta = const VerificationMeta('id');
  @override
  late final GeneratedColumn<int> id = GeneratedColumn<int>(
    'id',
    aliasedName,
    false,
    type: DriftSqlType.int,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _companyIdMeta = const VerificationMeta(
    'companyId',
  );
  @override
  late final GeneratedColumn<int> companyId = GeneratedColumn<int>(
    'company_id',
    aliasedName,
    false,
    type: DriftSqlType.int,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _projectIdMeta = const VerificationMeta(
    'projectId',
  );
  @override
  late final GeneratedColumn<int> projectId = GeneratedColumn<int>(
    'project_id',
    aliasedName,
    false,
    type: DriftSqlType.int,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _codeMeta = const VerificationMeta('code');
  @override
  late final GeneratedColumn<String> code = GeneratedColumn<String>(
    'code',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _descriptionMeta = const VerificationMeta(
    'description',
  );
  @override
  late final GeneratedColumn<String> description = GeneratedColumn<String>(
    'description',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
    defaultValue: const Constant(''),
  );
  static const VerificationMeta _kindMeta = const VerificationMeta('kind');
  @override
  late final GeneratedColumn<String> kind = GeneratedColumn<String>(
    'kind',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _uomMeta = const VerificationMeta('uom');
  @override
  late final GeneratedColumn<String> uom = GeneratedColumn<String>(
    'uom',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
    defaultValue: const Constant(''),
  );
  static const VerificationMeta _stageNameMeta = const VerificationMeta(
    'stageName',
  );
  @override
  late final GeneratedColumn<String> stageName = GeneratedColumn<String>(
    'stage_name',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
    defaultValue: const Constant(''),
  );
  static const VerificationMeta _volumeMeta = const VerificationMeta('volume');
  @override
  late final GeneratedColumn<double> volume = GeneratedColumn<double>(
    'volume',
    aliasedName,
    false,
    type: DriftSqlType.double,
    requiredDuringInsert: false,
    defaultValue: const Constant(0),
  );
  static const VerificationMeta _realisedMeta = const VerificationMeta(
    'realised',
  );
  @override
  late final GeneratedColumn<double> realised = GeneratedColumn<double>(
    'realised',
    aliasedName,
    false,
    type: DriftSqlType.double,
    requiredDuringInsert: false,
    defaultValue: const Constant(0),
  );
  static const VerificationMeta _receivedMeta = const VerificationMeta(
    'received',
  );
  @override
  late final GeneratedColumn<double> received = GeneratedColumn<double>(
    'received',
    aliasedName,
    false,
    type: DriftSqlType.double,
    requiredDuringInsert: false,
    defaultValue: const Constant(0),
  );
  static const VerificationMeta _usedMeta = const VerificationMeta('used');
  @override
  late final GeneratedColumn<double> used = GeneratedColumn<double>(
    'used',
    aliasedName,
    false,
    type: DriftSqlType.double,
    requiredDuringInsert: false,
    defaultValue: const Constant(0),
  );
  static const VerificationMeta _sortOrderMeta = const VerificationMeta(
    'sortOrder',
  );
  @override
  late final GeneratedColumn<int> sortOrder = GeneratedColumn<int>(
    'sort_order',
    aliasedName,
    false,
    type: DriftSqlType.int,
    requiredDuringInsert: false,
    defaultValue: const Constant(0),
  );
  static const VerificationMeta _activeMeta = const VerificationMeta('active');
  @override
  late final GeneratedColumn<bool> active = GeneratedColumn<bool>(
    'active',
    aliasedName,
    false,
    type: DriftSqlType.bool,
    requiredDuringInsert: false,
    defaultConstraints: GeneratedColumn.constraintIsAlways(
      'CHECK ("active" IN (0, 1))',
    ),
    defaultValue: const Constant(true),
  );
  @override
  List<GeneratedColumn> get $columns => [
    userSub,
    id,
    companyId,
    projectId,
    code,
    description,
    kind,
    uom,
    stageName,
    volume,
    realised,
    received,
    used,
    sortOrder,
    active,
  ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'field_rap_items';
  @override
  VerificationContext validateIntegrity(
    Insertable<FieldRapItemRow> instance, {
    bool isInserting = false,
  }) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('user_sub')) {
      context.handle(
        _userSubMeta,
        userSub.isAcceptableOrUnknown(data['user_sub']!, _userSubMeta),
      );
    } else if (isInserting) {
      context.missing(_userSubMeta);
    }
    if (data.containsKey('id')) {
      context.handle(_idMeta, id.isAcceptableOrUnknown(data['id']!, _idMeta));
    } else if (isInserting) {
      context.missing(_idMeta);
    }
    if (data.containsKey('company_id')) {
      context.handle(
        _companyIdMeta,
        companyId.isAcceptableOrUnknown(data['company_id']!, _companyIdMeta),
      );
    } else if (isInserting) {
      context.missing(_companyIdMeta);
    }
    if (data.containsKey('project_id')) {
      context.handle(
        _projectIdMeta,
        projectId.isAcceptableOrUnknown(data['project_id']!, _projectIdMeta),
      );
    } else if (isInserting) {
      context.missing(_projectIdMeta);
    }
    if (data.containsKey('code')) {
      context.handle(
        _codeMeta,
        code.isAcceptableOrUnknown(data['code']!, _codeMeta),
      );
    } else if (isInserting) {
      context.missing(_codeMeta);
    }
    if (data.containsKey('description')) {
      context.handle(
        _descriptionMeta,
        description.isAcceptableOrUnknown(
          data['description']!,
          _descriptionMeta,
        ),
      );
    }
    if (data.containsKey('kind')) {
      context.handle(
        _kindMeta,
        kind.isAcceptableOrUnknown(data['kind']!, _kindMeta),
      );
    } else if (isInserting) {
      context.missing(_kindMeta);
    }
    if (data.containsKey('uom')) {
      context.handle(
        _uomMeta,
        uom.isAcceptableOrUnknown(data['uom']!, _uomMeta),
      );
    }
    if (data.containsKey('stage_name')) {
      context.handle(
        _stageNameMeta,
        stageName.isAcceptableOrUnknown(data['stage_name']!, _stageNameMeta),
      );
    }
    if (data.containsKey('volume')) {
      context.handle(
        _volumeMeta,
        volume.isAcceptableOrUnknown(data['volume']!, _volumeMeta),
      );
    }
    if (data.containsKey('realised')) {
      context.handle(
        _realisedMeta,
        realised.isAcceptableOrUnknown(data['realised']!, _realisedMeta),
      );
    }
    if (data.containsKey('received')) {
      context.handle(
        _receivedMeta,
        received.isAcceptableOrUnknown(data['received']!, _receivedMeta),
      );
    }
    if (data.containsKey('used')) {
      context.handle(
        _usedMeta,
        used.isAcceptableOrUnknown(data['used']!, _usedMeta),
      );
    }
    if (data.containsKey('sort_order')) {
      context.handle(
        _sortOrderMeta,
        sortOrder.isAcceptableOrUnknown(data['sort_order']!, _sortOrderMeta),
      );
    }
    if (data.containsKey('active')) {
      context.handle(
        _activeMeta,
        active.isAcceptableOrUnknown(data['active']!, _activeMeta),
      );
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {userSub, id};
  @override
  FieldRapItemRow map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return FieldRapItemRow(
      userSub: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}user_sub'],
      )!,
      id: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}id'],
      )!,
      companyId: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}company_id'],
      )!,
      projectId: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}project_id'],
      )!,
      code: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}code'],
      )!,
      description: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}description'],
      )!,
      kind: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}kind'],
      )!,
      uom: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}uom'],
      )!,
      stageName: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}stage_name'],
      )!,
      volume: attachedDatabase.typeMapping.read(
        DriftSqlType.double,
        data['${effectivePrefix}volume'],
      )!,
      realised: attachedDatabase.typeMapping.read(
        DriftSqlType.double,
        data['${effectivePrefix}realised'],
      )!,
      received: attachedDatabase.typeMapping.read(
        DriftSqlType.double,
        data['${effectivePrefix}received'],
      )!,
      used: attachedDatabase.typeMapping.read(
        DriftSqlType.double,
        data['${effectivePrefix}used'],
      )!,
      sortOrder: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}sort_order'],
      )!,
      active: attachedDatabase.typeMapping.read(
        DriftSqlType.bool,
        data['${effectivePrefix}active'],
      )!,
    );
  }

  @override
  $FieldRapItemsTable createAlias(String alias) {
    return $FieldRapItemsTable(attachedDatabase, alias);
  }
}

class FieldRapItemRow extends DataClass implements Insertable<FieldRapItemRow> {
  final String userSub;
  final int id;
  final int companyId;
  final int projectId;
  final String code;
  final String description;

  /// pekerjaan | material
  final String kind;
  final String uom;
  final String stageName;
  final double volume;
  final double realised;
  final double received;
  final double used;
  final int sortOrder;
  final bool active;
  const FieldRapItemRow({
    required this.userSub,
    required this.id,
    required this.companyId,
    required this.projectId,
    required this.code,
    required this.description,
    required this.kind,
    required this.uom,
    required this.stageName,
    required this.volume,
    required this.realised,
    required this.received,
    required this.used,
    required this.sortOrder,
    required this.active,
  });
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['user_sub'] = Variable<String>(userSub);
    map['id'] = Variable<int>(id);
    map['company_id'] = Variable<int>(companyId);
    map['project_id'] = Variable<int>(projectId);
    map['code'] = Variable<String>(code);
    map['description'] = Variable<String>(description);
    map['kind'] = Variable<String>(kind);
    map['uom'] = Variable<String>(uom);
    map['stage_name'] = Variable<String>(stageName);
    map['volume'] = Variable<double>(volume);
    map['realised'] = Variable<double>(realised);
    map['received'] = Variable<double>(received);
    map['used'] = Variable<double>(used);
    map['sort_order'] = Variable<int>(sortOrder);
    map['active'] = Variable<bool>(active);
    return map;
  }

  FieldRapItemsCompanion toCompanion(bool nullToAbsent) {
    return FieldRapItemsCompanion(
      userSub: Value(userSub),
      id: Value(id),
      companyId: Value(companyId),
      projectId: Value(projectId),
      code: Value(code),
      description: Value(description),
      kind: Value(kind),
      uom: Value(uom),
      stageName: Value(stageName),
      volume: Value(volume),
      realised: Value(realised),
      received: Value(received),
      used: Value(used),
      sortOrder: Value(sortOrder),
      active: Value(active),
    );
  }

  factory FieldRapItemRow.fromJson(
    Map<String, dynamic> json, {
    ValueSerializer? serializer,
  }) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return FieldRapItemRow(
      userSub: serializer.fromJson<String>(json['userSub']),
      id: serializer.fromJson<int>(json['id']),
      companyId: serializer.fromJson<int>(json['companyId']),
      projectId: serializer.fromJson<int>(json['projectId']),
      code: serializer.fromJson<String>(json['code']),
      description: serializer.fromJson<String>(json['description']),
      kind: serializer.fromJson<String>(json['kind']),
      uom: serializer.fromJson<String>(json['uom']),
      stageName: serializer.fromJson<String>(json['stageName']),
      volume: serializer.fromJson<double>(json['volume']),
      realised: serializer.fromJson<double>(json['realised']),
      received: serializer.fromJson<double>(json['received']),
      used: serializer.fromJson<double>(json['used']),
      sortOrder: serializer.fromJson<int>(json['sortOrder']),
      active: serializer.fromJson<bool>(json['active']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'userSub': serializer.toJson<String>(userSub),
      'id': serializer.toJson<int>(id),
      'companyId': serializer.toJson<int>(companyId),
      'projectId': serializer.toJson<int>(projectId),
      'code': serializer.toJson<String>(code),
      'description': serializer.toJson<String>(description),
      'kind': serializer.toJson<String>(kind),
      'uom': serializer.toJson<String>(uom),
      'stageName': serializer.toJson<String>(stageName),
      'volume': serializer.toJson<double>(volume),
      'realised': serializer.toJson<double>(realised),
      'received': serializer.toJson<double>(received),
      'used': serializer.toJson<double>(used),
      'sortOrder': serializer.toJson<int>(sortOrder),
      'active': serializer.toJson<bool>(active),
    };
  }

  FieldRapItemRow copyWith({
    String? userSub,
    int? id,
    int? companyId,
    int? projectId,
    String? code,
    String? description,
    String? kind,
    String? uom,
    String? stageName,
    double? volume,
    double? realised,
    double? received,
    double? used,
    int? sortOrder,
    bool? active,
  }) => FieldRapItemRow(
    userSub: userSub ?? this.userSub,
    id: id ?? this.id,
    companyId: companyId ?? this.companyId,
    projectId: projectId ?? this.projectId,
    code: code ?? this.code,
    description: description ?? this.description,
    kind: kind ?? this.kind,
    uom: uom ?? this.uom,
    stageName: stageName ?? this.stageName,
    volume: volume ?? this.volume,
    realised: realised ?? this.realised,
    received: received ?? this.received,
    used: used ?? this.used,
    sortOrder: sortOrder ?? this.sortOrder,
    active: active ?? this.active,
  );
  FieldRapItemRow copyWithCompanion(FieldRapItemsCompanion data) {
    return FieldRapItemRow(
      userSub: data.userSub.present ? data.userSub.value : this.userSub,
      id: data.id.present ? data.id.value : this.id,
      companyId: data.companyId.present ? data.companyId.value : this.companyId,
      projectId: data.projectId.present ? data.projectId.value : this.projectId,
      code: data.code.present ? data.code.value : this.code,
      description: data.description.present
          ? data.description.value
          : this.description,
      kind: data.kind.present ? data.kind.value : this.kind,
      uom: data.uom.present ? data.uom.value : this.uom,
      stageName: data.stageName.present ? data.stageName.value : this.stageName,
      volume: data.volume.present ? data.volume.value : this.volume,
      realised: data.realised.present ? data.realised.value : this.realised,
      received: data.received.present ? data.received.value : this.received,
      used: data.used.present ? data.used.value : this.used,
      sortOrder: data.sortOrder.present ? data.sortOrder.value : this.sortOrder,
      active: data.active.present ? data.active.value : this.active,
    );
  }

  @override
  String toString() {
    return (StringBuffer('FieldRapItemRow(')
          ..write('userSub: $userSub, ')
          ..write('id: $id, ')
          ..write('companyId: $companyId, ')
          ..write('projectId: $projectId, ')
          ..write('code: $code, ')
          ..write('description: $description, ')
          ..write('kind: $kind, ')
          ..write('uom: $uom, ')
          ..write('stageName: $stageName, ')
          ..write('volume: $volume, ')
          ..write('realised: $realised, ')
          ..write('received: $received, ')
          ..write('used: $used, ')
          ..write('sortOrder: $sortOrder, ')
          ..write('active: $active')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(
    userSub,
    id,
    companyId,
    projectId,
    code,
    description,
    kind,
    uom,
    stageName,
    volume,
    realised,
    received,
    used,
    sortOrder,
    active,
  );
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is FieldRapItemRow &&
          other.userSub == this.userSub &&
          other.id == this.id &&
          other.companyId == this.companyId &&
          other.projectId == this.projectId &&
          other.code == this.code &&
          other.description == this.description &&
          other.kind == this.kind &&
          other.uom == this.uom &&
          other.stageName == this.stageName &&
          other.volume == this.volume &&
          other.realised == this.realised &&
          other.received == this.received &&
          other.used == this.used &&
          other.sortOrder == this.sortOrder &&
          other.active == this.active);
}

class FieldRapItemsCompanion extends UpdateCompanion<FieldRapItemRow> {
  final Value<String> userSub;
  final Value<int> id;
  final Value<int> companyId;
  final Value<int> projectId;
  final Value<String> code;
  final Value<String> description;
  final Value<String> kind;
  final Value<String> uom;
  final Value<String> stageName;
  final Value<double> volume;
  final Value<double> realised;
  final Value<double> received;
  final Value<double> used;
  final Value<int> sortOrder;
  final Value<bool> active;
  final Value<int> rowid;
  const FieldRapItemsCompanion({
    this.userSub = const Value.absent(),
    this.id = const Value.absent(),
    this.companyId = const Value.absent(),
    this.projectId = const Value.absent(),
    this.code = const Value.absent(),
    this.description = const Value.absent(),
    this.kind = const Value.absent(),
    this.uom = const Value.absent(),
    this.stageName = const Value.absent(),
    this.volume = const Value.absent(),
    this.realised = const Value.absent(),
    this.received = const Value.absent(),
    this.used = const Value.absent(),
    this.sortOrder = const Value.absent(),
    this.active = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  FieldRapItemsCompanion.insert({
    required String userSub,
    required int id,
    required int companyId,
    required int projectId,
    required String code,
    this.description = const Value.absent(),
    required String kind,
    this.uom = const Value.absent(),
    this.stageName = const Value.absent(),
    this.volume = const Value.absent(),
    this.realised = const Value.absent(),
    this.received = const Value.absent(),
    this.used = const Value.absent(),
    this.sortOrder = const Value.absent(),
    this.active = const Value.absent(),
    this.rowid = const Value.absent(),
  }) : userSub = Value(userSub),
       id = Value(id),
       companyId = Value(companyId),
       projectId = Value(projectId),
       code = Value(code),
       kind = Value(kind);
  static Insertable<FieldRapItemRow> custom({
    Expression<String>? userSub,
    Expression<int>? id,
    Expression<int>? companyId,
    Expression<int>? projectId,
    Expression<String>? code,
    Expression<String>? description,
    Expression<String>? kind,
    Expression<String>? uom,
    Expression<String>? stageName,
    Expression<double>? volume,
    Expression<double>? realised,
    Expression<double>? received,
    Expression<double>? used,
    Expression<int>? sortOrder,
    Expression<bool>? active,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (userSub != null) 'user_sub': userSub,
      if (id != null) 'id': id,
      if (companyId != null) 'company_id': companyId,
      if (projectId != null) 'project_id': projectId,
      if (code != null) 'code': code,
      if (description != null) 'description': description,
      if (kind != null) 'kind': kind,
      if (uom != null) 'uom': uom,
      if (stageName != null) 'stage_name': stageName,
      if (volume != null) 'volume': volume,
      if (realised != null) 'realised': realised,
      if (received != null) 'received': received,
      if (used != null) 'used': used,
      if (sortOrder != null) 'sort_order': sortOrder,
      if (active != null) 'active': active,
      if (rowid != null) 'rowid': rowid,
    });
  }

  FieldRapItemsCompanion copyWith({
    Value<String>? userSub,
    Value<int>? id,
    Value<int>? companyId,
    Value<int>? projectId,
    Value<String>? code,
    Value<String>? description,
    Value<String>? kind,
    Value<String>? uom,
    Value<String>? stageName,
    Value<double>? volume,
    Value<double>? realised,
    Value<double>? received,
    Value<double>? used,
    Value<int>? sortOrder,
    Value<bool>? active,
    Value<int>? rowid,
  }) {
    return FieldRapItemsCompanion(
      userSub: userSub ?? this.userSub,
      id: id ?? this.id,
      companyId: companyId ?? this.companyId,
      projectId: projectId ?? this.projectId,
      code: code ?? this.code,
      description: description ?? this.description,
      kind: kind ?? this.kind,
      uom: uom ?? this.uom,
      stageName: stageName ?? this.stageName,
      volume: volume ?? this.volume,
      realised: realised ?? this.realised,
      received: received ?? this.received,
      used: used ?? this.used,
      sortOrder: sortOrder ?? this.sortOrder,
      active: active ?? this.active,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (userSub.present) {
      map['user_sub'] = Variable<String>(userSub.value);
    }
    if (id.present) {
      map['id'] = Variable<int>(id.value);
    }
    if (companyId.present) {
      map['company_id'] = Variable<int>(companyId.value);
    }
    if (projectId.present) {
      map['project_id'] = Variable<int>(projectId.value);
    }
    if (code.present) {
      map['code'] = Variable<String>(code.value);
    }
    if (description.present) {
      map['description'] = Variable<String>(description.value);
    }
    if (kind.present) {
      map['kind'] = Variable<String>(kind.value);
    }
    if (uom.present) {
      map['uom'] = Variable<String>(uom.value);
    }
    if (stageName.present) {
      map['stage_name'] = Variable<String>(stageName.value);
    }
    if (volume.present) {
      map['volume'] = Variable<double>(volume.value);
    }
    if (realised.present) {
      map['realised'] = Variable<double>(realised.value);
    }
    if (received.present) {
      map['received'] = Variable<double>(received.value);
    }
    if (used.present) {
      map['used'] = Variable<double>(used.value);
    }
    if (sortOrder.present) {
      map['sort_order'] = Variable<int>(sortOrder.value);
    }
    if (active.present) {
      map['active'] = Variable<bool>(active.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('FieldRapItemsCompanion(')
          ..write('userSub: $userSub, ')
          ..write('id: $id, ')
          ..write('companyId: $companyId, ')
          ..write('projectId: $projectId, ')
          ..write('code: $code, ')
          ..write('description: $description, ')
          ..write('kind: $kind, ')
          ..write('uom: $uom, ')
          ..write('stageName: $stageName, ')
          ..write('volume: $volume, ')
          ..write('realised: $realised, ')
          ..write('received: $received, ')
          ..write('used: $used, ')
          ..write('sortOrder: $sortOrder, ')
          ..write('active: $active, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

class $FieldResourceTypesTable extends FieldResourceTypes
    with TableInfo<$FieldResourceTypesTable, FieldResourceTypeRow> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $FieldResourceTypesTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _userSubMeta = const VerificationMeta(
    'userSub',
  );
  @override
  late final GeneratedColumn<String> userSub = GeneratedColumn<String>(
    'user_sub',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _idMeta = const VerificationMeta('id');
  @override
  late final GeneratedColumn<int> id = GeneratedColumn<int>(
    'id',
    aliasedName,
    false,
    type: DriftSqlType.int,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _companyIdMeta = const VerificationMeta(
    'companyId',
  );
  @override
  late final GeneratedColumn<int> companyId = GeneratedColumn<int>(
    'company_id',
    aliasedName,
    false,
    type: DriftSqlType.int,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _kindMeta = const VerificationMeta('kind');
  @override
  late final GeneratedColumn<String> kind = GeneratedColumn<String>(
    'kind',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _codeMeta = const VerificationMeta('code');
  @override
  late final GeneratedColumn<String> code = GeneratedColumn<String>(
    'code',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
    defaultValue: const Constant(''),
  );
  static const VerificationMeta _nameMeta = const VerificationMeta('name');
  @override
  late final GeneratedColumn<String> name = GeneratedColumn<String>(
    'name',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
    defaultValue: const Constant(''),
  );
  @override
  List<GeneratedColumn> get $columns => [
    userSub,
    id,
    companyId,
    kind,
    code,
    name,
  ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'field_resource_types';
  @override
  VerificationContext validateIntegrity(
    Insertable<FieldResourceTypeRow> instance, {
    bool isInserting = false,
  }) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('user_sub')) {
      context.handle(
        _userSubMeta,
        userSub.isAcceptableOrUnknown(data['user_sub']!, _userSubMeta),
      );
    } else if (isInserting) {
      context.missing(_userSubMeta);
    }
    if (data.containsKey('id')) {
      context.handle(_idMeta, id.isAcceptableOrUnknown(data['id']!, _idMeta));
    } else if (isInserting) {
      context.missing(_idMeta);
    }
    if (data.containsKey('company_id')) {
      context.handle(
        _companyIdMeta,
        companyId.isAcceptableOrUnknown(data['company_id']!, _companyIdMeta),
      );
    } else if (isInserting) {
      context.missing(_companyIdMeta);
    }
    if (data.containsKey('kind')) {
      context.handle(
        _kindMeta,
        kind.isAcceptableOrUnknown(data['kind']!, _kindMeta),
      );
    } else if (isInserting) {
      context.missing(_kindMeta);
    }
    if (data.containsKey('code')) {
      context.handle(
        _codeMeta,
        code.isAcceptableOrUnknown(data['code']!, _codeMeta),
      );
    }
    if (data.containsKey('name')) {
      context.handle(
        _nameMeta,
        name.isAcceptableOrUnknown(data['name']!, _nameMeta),
      );
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {userSub, id};
  @override
  FieldResourceTypeRow map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return FieldResourceTypeRow(
      userSub: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}user_sub'],
      )!,
      id: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}id'],
      )!,
      companyId: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}company_id'],
      )!,
      kind: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}kind'],
      )!,
      code: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}code'],
      )!,
      name: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}name'],
      )!,
    );
  }

  @override
  $FieldResourceTypesTable createAlias(String alias) {
    return $FieldResourceTypesTable(attachedDatabase, alias);
  }
}

class FieldResourceTypeRow extends DataClass
    implements Insertable<FieldResourceTypeRow> {
  final String userSub;
  final int id;
  final int companyId;

  /// tenaga | alat
  final String kind;
  final String code;
  final String name;
  const FieldResourceTypeRow({
    required this.userSub,
    required this.id,
    required this.companyId,
    required this.kind,
    required this.code,
    required this.name,
  });
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['user_sub'] = Variable<String>(userSub);
    map['id'] = Variable<int>(id);
    map['company_id'] = Variable<int>(companyId);
    map['kind'] = Variable<String>(kind);
    map['code'] = Variable<String>(code);
    map['name'] = Variable<String>(name);
    return map;
  }

  FieldResourceTypesCompanion toCompanion(bool nullToAbsent) {
    return FieldResourceTypesCompanion(
      userSub: Value(userSub),
      id: Value(id),
      companyId: Value(companyId),
      kind: Value(kind),
      code: Value(code),
      name: Value(name),
    );
  }

  factory FieldResourceTypeRow.fromJson(
    Map<String, dynamic> json, {
    ValueSerializer? serializer,
  }) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return FieldResourceTypeRow(
      userSub: serializer.fromJson<String>(json['userSub']),
      id: serializer.fromJson<int>(json['id']),
      companyId: serializer.fromJson<int>(json['companyId']),
      kind: serializer.fromJson<String>(json['kind']),
      code: serializer.fromJson<String>(json['code']),
      name: serializer.fromJson<String>(json['name']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'userSub': serializer.toJson<String>(userSub),
      'id': serializer.toJson<int>(id),
      'companyId': serializer.toJson<int>(companyId),
      'kind': serializer.toJson<String>(kind),
      'code': serializer.toJson<String>(code),
      'name': serializer.toJson<String>(name),
    };
  }

  FieldResourceTypeRow copyWith({
    String? userSub,
    int? id,
    int? companyId,
    String? kind,
    String? code,
    String? name,
  }) => FieldResourceTypeRow(
    userSub: userSub ?? this.userSub,
    id: id ?? this.id,
    companyId: companyId ?? this.companyId,
    kind: kind ?? this.kind,
    code: code ?? this.code,
    name: name ?? this.name,
  );
  FieldResourceTypeRow copyWithCompanion(FieldResourceTypesCompanion data) {
    return FieldResourceTypeRow(
      userSub: data.userSub.present ? data.userSub.value : this.userSub,
      id: data.id.present ? data.id.value : this.id,
      companyId: data.companyId.present ? data.companyId.value : this.companyId,
      kind: data.kind.present ? data.kind.value : this.kind,
      code: data.code.present ? data.code.value : this.code,
      name: data.name.present ? data.name.value : this.name,
    );
  }

  @override
  String toString() {
    return (StringBuffer('FieldResourceTypeRow(')
          ..write('userSub: $userSub, ')
          ..write('id: $id, ')
          ..write('companyId: $companyId, ')
          ..write('kind: $kind, ')
          ..write('code: $code, ')
          ..write('name: $name')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(userSub, id, companyId, kind, code, name);
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is FieldResourceTypeRow &&
          other.userSub == this.userSub &&
          other.id == this.id &&
          other.companyId == this.companyId &&
          other.kind == this.kind &&
          other.code == this.code &&
          other.name == this.name);
}

class FieldResourceTypesCompanion
    extends UpdateCompanion<FieldResourceTypeRow> {
  final Value<String> userSub;
  final Value<int> id;
  final Value<int> companyId;
  final Value<String> kind;
  final Value<String> code;
  final Value<String> name;
  final Value<int> rowid;
  const FieldResourceTypesCompanion({
    this.userSub = const Value.absent(),
    this.id = const Value.absent(),
    this.companyId = const Value.absent(),
    this.kind = const Value.absent(),
    this.code = const Value.absent(),
    this.name = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  FieldResourceTypesCompanion.insert({
    required String userSub,
    required int id,
    required int companyId,
    required String kind,
    this.code = const Value.absent(),
    this.name = const Value.absent(),
    this.rowid = const Value.absent(),
  }) : userSub = Value(userSub),
       id = Value(id),
       companyId = Value(companyId),
       kind = Value(kind);
  static Insertable<FieldResourceTypeRow> custom({
    Expression<String>? userSub,
    Expression<int>? id,
    Expression<int>? companyId,
    Expression<String>? kind,
    Expression<String>? code,
    Expression<String>? name,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (userSub != null) 'user_sub': userSub,
      if (id != null) 'id': id,
      if (companyId != null) 'company_id': companyId,
      if (kind != null) 'kind': kind,
      if (code != null) 'code': code,
      if (name != null) 'name': name,
      if (rowid != null) 'rowid': rowid,
    });
  }

  FieldResourceTypesCompanion copyWith({
    Value<String>? userSub,
    Value<int>? id,
    Value<int>? companyId,
    Value<String>? kind,
    Value<String>? code,
    Value<String>? name,
    Value<int>? rowid,
  }) {
    return FieldResourceTypesCompanion(
      userSub: userSub ?? this.userSub,
      id: id ?? this.id,
      companyId: companyId ?? this.companyId,
      kind: kind ?? this.kind,
      code: code ?? this.code,
      name: name ?? this.name,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (userSub.present) {
      map['user_sub'] = Variable<String>(userSub.value);
    }
    if (id.present) {
      map['id'] = Variable<int>(id.value);
    }
    if (companyId.present) {
      map['company_id'] = Variable<int>(companyId.value);
    }
    if (kind.present) {
      map['kind'] = Variable<String>(kind.value);
    }
    if (code.present) {
      map['code'] = Variable<String>(code.value);
    }
    if (name.present) {
      map['name'] = Variable<String>(name.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('FieldResourceTypesCompanion(')
          ..write('userSub: $userSub, ')
          ..write('id: $id, ')
          ..write('companyId: $companyId, ')
          ..write('kind: $kind, ')
          ..write('code: $code, ')
          ..write('name: $name, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

class $FieldServiceTypesTable extends FieldServiceTypes
    with TableInfo<$FieldServiceTypesTable, FieldServiceTypeRow> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $FieldServiceTypesTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _userSubMeta = const VerificationMeta(
    'userSub',
  );
  @override
  late final GeneratedColumn<String> userSub = GeneratedColumn<String>(
    'user_sub',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _idMeta = const VerificationMeta('id');
  @override
  late final GeneratedColumn<int> id = GeneratedColumn<int>(
    'id',
    aliasedName,
    false,
    type: DriftSqlType.int,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _companyIdMeta = const VerificationMeta(
    'companyId',
  );
  @override
  late final GeneratedColumn<int> companyId = GeneratedColumn<int>(
    'company_id',
    aliasedName,
    false,
    type: DriftSqlType.int,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _codeMeta = const VerificationMeta('code');
  @override
  late final GeneratedColumn<String> code = GeneratedColumn<String>(
    'code',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
    defaultValue: const Constant(''),
  );
  static const VerificationMeta _nameMeta = const VerificationMeta('name');
  @override
  late final GeneratedColumn<String> name = GeneratedColumn<String>(
    'name',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
    defaultValue: const Constant(''),
  );
  static const VerificationMeta _activeMeta = const VerificationMeta('active');
  @override
  late final GeneratedColumn<bool> active = GeneratedColumn<bool>(
    'active',
    aliasedName,
    false,
    type: DriftSqlType.bool,
    requiredDuringInsert: false,
    defaultConstraints: GeneratedColumn.constraintIsAlways(
      'CHECK ("active" IN (0, 1))',
    ),
    defaultValue: const Constant(true),
  );
  static const VerificationMeta _sortOrderMeta = const VerificationMeta(
    'sortOrder',
  );
  @override
  late final GeneratedColumn<int> sortOrder = GeneratedColumn<int>(
    'sort_order',
    aliasedName,
    false,
    type: DriftSqlType.int,
    requiredDuringInsert: false,
    defaultValue: const Constant(0),
  );
  @override
  List<GeneratedColumn> get $columns => [
    userSub,
    id,
    companyId,
    code,
    name,
    active,
    sortOrder,
  ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'field_service_types';
  @override
  VerificationContext validateIntegrity(
    Insertable<FieldServiceTypeRow> instance, {
    bool isInserting = false,
  }) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('user_sub')) {
      context.handle(
        _userSubMeta,
        userSub.isAcceptableOrUnknown(data['user_sub']!, _userSubMeta),
      );
    } else if (isInserting) {
      context.missing(_userSubMeta);
    }
    if (data.containsKey('id')) {
      context.handle(_idMeta, id.isAcceptableOrUnknown(data['id']!, _idMeta));
    } else if (isInserting) {
      context.missing(_idMeta);
    }
    if (data.containsKey('company_id')) {
      context.handle(
        _companyIdMeta,
        companyId.isAcceptableOrUnknown(data['company_id']!, _companyIdMeta),
      );
    } else if (isInserting) {
      context.missing(_companyIdMeta);
    }
    if (data.containsKey('code')) {
      context.handle(
        _codeMeta,
        code.isAcceptableOrUnknown(data['code']!, _codeMeta),
      );
    }
    if (data.containsKey('name')) {
      context.handle(
        _nameMeta,
        name.isAcceptableOrUnknown(data['name']!, _nameMeta),
      );
    }
    if (data.containsKey('active')) {
      context.handle(
        _activeMeta,
        active.isAcceptableOrUnknown(data['active']!, _activeMeta),
      );
    }
    if (data.containsKey('sort_order')) {
      context.handle(
        _sortOrderMeta,
        sortOrder.isAcceptableOrUnknown(data['sort_order']!, _sortOrderMeta),
      );
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {userSub, id};
  @override
  FieldServiceTypeRow map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return FieldServiceTypeRow(
      userSub: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}user_sub'],
      )!,
      id: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}id'],
      )!,
      companyId: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}company_id'],
      )!,
      code: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}code'],
      )!,
      name: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}name'],
      )!,
      active: attachedDatabase.typeMapping.read(
        DriftSqlType.bool,
        data['${effectivePrefix}active'],
      )!,
      sortOrder: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}sort_order'],
      )!,
    );
  }

  @override
  $FieldServiceTypesTable createAlias(String alias) {
    return $FieldServiceTypesTable(attachedDatabase, alias);
  }
}

class FieldServiceTypeRow extends DataClass
    implements Insertable<FieldServiceTypeRow> {
  final String userSub;
  final int id;
  final int companyId;
  final String code;
  final String name;
  final bool active;
  final int sortOrder;
  const FieldServiceTypeRow({
    required this.userSub,
    required this.id,
    required this.companyId,
    required this.code,
    required this.name,
    required this.active,
    required this.sortOrder,
  });
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['user_sub'] = Variable<String>(userSub);
    map['id'] = Variable<int>(id);
    map['company_id'] = Variable<int>(companyId);
    map['code'] = Variable<String>(code);
    map['name'] = Variable<String>(name);
    map['active'] = Variable<bool>(active);
    map['sort_order'] = Variable<int>(sortOrder);
    return map;
  }

  FieldServiceTypesCompanion toCompanion(bool nullToAbsent) {
    return FieldServiceTypesCompanion(
      userSub: Value(userSub),
      id: Value(id),
      companyId: Value(companyId),
      code: Value(code),
      name: Value(name),
      active: Value(active),
      sortOrder: Value(sortOrder),
    );
  }

  factory FieldServiceTypeRow.fromJson(
    Map<String, dynamic> json, {
    ValueSerializer? serializer,
  }) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return FieldServiceTypeRow(
      userSub: serializer.fromJson<String>(json['userSub']),
      id: serializer.fromJson<int>(json['id']),
      companyId: serializer.fromJson<int>(json['companyId']),
      code: serializer.fromJson<String>(json['code']),
      name: serializer.fromJson<String>(json['name']),
      active: serializer.fromJson<bool>(json['active']),
      sortOrder: serializer.fromJson<int>(json['sortOrder']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'userSub': serializer.toJson<String>(userSub),
      'id': serializer.toJson<int>(id),
      'companyId': serializer.toJson<int>(companyId),
      'code': serializer.toJson<String>(code),
      'name': serializer.toJson<String>(name),
      'active': serializer.toJson<bool>(active),
      'sortOrder': serializer.toJson<int>(sortOrder),
    };
  }

  FieldServiceTypeRow copyWith({
    String? userSub,
    int? id,
    int? companyId,
    String? code,
    String? name,
    bool? active,
    int? sortOrder,
  }) => FieldServiceTypeRow(
    userSub: userSub ?? this.userSub,
    id: id ?? this.id,
    companyId: companyId ?? this.companyId,
    code: code ?? this.code,
    name: name ?? this.name,
    active: active ?? this.active,
    sortOrder: sortOrder ?? this.sortOrder,
  );
  FieldServiceTypeRow copyWithCompanion(FieldServiceTypesCompanion data) {
    return FieldServiceTypeRow(
      userSub: data.userSub.present ? data.userSub.value : this.userSub,
      id: data.id.present ? data.id.value : this.id,
      companyId: data.companyId.present ? data.companyId.value : this.companyId,
      code: data.code.present ? data.code.value : this.code,
      name: data.name.present ? data.name.value : this.name,
      active: data.active.present ? data.active.value : this.active,
      sortOrder: data.sortOrder.present ? data.sortOrder.value : this.sortOrder,
    );
  }

  @override
  String toString() {
    return (StringBuffer('FieldServiceTypeRow(')
          ..write('userSub: $userSub, ')
          ..write('id: $id, ')
          ..write('companyId: $companyId, ')
          ..write('code: $code, ')
          ..write('name: $name, ')
          ..write('active: $active, ')
          ..write('sortOrder: $sortOrder')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode =>
      Object.hash(userSub, id, companyId, code, name, active, sortOrder);
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is FieldServiceTypeRow &&
          other.userSub == this.userSub &&
          other.id == this.id &&
          other.companyId == this.companyId &&
          other.code == this.code &&
          other.name == this.name &&
          other.active == this.active &&
          other.sortOrder == this.sortOrder);
}

class FieldServiceTypesCompanion extends UpdateCompanion<FieldServiceTypeRow> {
  final Value<String> userSub;
  final Value<int> id;
  final Value<int> companyId;
  final Value<String> code;
  final Value<String> name;
  final Value<bool> active;
  final Value<int> sortOrder;
  final Value<int> rowid;
  const FieldServiceTypesCompanion({
    this.userSub = const Value.absent(),
    this.id = const Value.absent(),
    this.companyId = const Value.absent(),
    this.code = const Value.absent(),
    this.name = const Value.absent(),
    this.active = const Value.absent(),
    this.sortOrder = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  FieldServiceTypesCompanion.insert({
    required String userSub,
    required int id,
    required int companyId,
    this.code = const Value.absent(),
    this.name = const Value.absent(),
    this.active = const Value.absent(),
    this.sortOrder = const Value.absent(),
    this.rowid = const Value.absent(),
  }) : userSub = Value(userSub),
       id = Value(id),
       companyId = Value(companyId);
  static Insertable<FieldServiceTypeRow> custom({
    Expression<String>? userSub,
    Expression<int>? id,
    Expression<int>? companyId,
    Expression<String>? code,
    Expression<String>? name,
    Expression<bool>? active,
    Expression<int>? sortOrder,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (userSub != null) 'user_sub': userSub,
      if (id != null) 'id': id,
      if (companyId != null) 'company_id': companyId,
      if (code != null) 'code': code,
      if (name != null) 'name': name,
      if (active != null) 'active': active,
      if (sortOrder != null) 'sort_order': sortOrder,
      if (rowid != null) 'rowid': rowid,
    });
  }

  FieldServiceTypesCompanion copyWith({
    Value<String>? userSub,
    Value<int>? id,
    Value<int>? companyId,
    Value<String>? code,
    Value<String>? name,
    Value<bool>? active,
    Value<int>? sortOrder,
    Value<int>? rowid,
  }) {
    return FieldServiceTypesCompanion(
      userSub: userSub ?? this.userSub,
      id: id ?? this.id,
      companyId: companyId ?? this.companyId,
      code: code ?? this.code,
      name: name ?? this.name,
      active: active ?? this.active,
      sortOrder: sortOrder ?? this.sortOrder,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (userSub.present) {
      map['user_sub'] = Variable<String>(userSub.value);
    }
    if (id.present) {
      map['id'] = Variable<int>(id.value);
    }
    if (companyId.present) {
      map['company_id'] = Variable<int>(companyId.value);
    }
    if (code.present) {
      map['code'] = Variable<String>(code.value);
    }
    if (name.present) {
      map['name'] = Variable<String>(name.value);
    }
    if (active.present) {
      map['active'] = Variable<bool>(active.value);
    }
    if (sortOrder.present) {
      map['sort_order'] = Variable<int>(sortOrder.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('FieldServiceTypesCompanion(')
          ..write('userSub: $userSub, ')
          ..write('id: $id, ')
          ..write('companyId: $companyId, ')
          ..write('code: $code, ')
          ..write('name: $name, ')
          ..write('active: $active, ')
          ..write('sortOrder: $sortOrder, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

abstract class _$AppDatabase extends GeneratedDatabase {
  _$AppDatabase(QueryExecutor e) : super(e);
  $AppDatabaseManager get managers => $AppDatabaseManager(this);
  late final $LocalDraftsTable localDrafts = $LocalDraftsTable(this);
  late final $LocalLinesTable localLines = $LocalLinesTable(this);
  late final $LocalReceiptsTable localReceipts = $LocalReceiptsTable(this);
  late final $MediaBlobsTable mediaBlobs = $MediaBlobsTable(this);
  late final $OutboxTable outbox = $OutboxTable(this);
  late final $KvEntriesTable kvEntries = $KvEntriesTable(this);
  late final $LocalProgressReportsTable localProgressReports =
      $LocalProgressReportsTable(this);
  late final $LocalFieldReportsTable localFieldReports =
      $LocalFieldReportsTable(this);
  late final $FieldUnitsTable fieldUnits = $FieldUnitsTable(this);
  late final $FieldContractUnitsTable fieldContractUnits =
      $FieldContractUnitsTable(this);
  late final $FieldOpenPosTable fieldOpenPos = $FieldOpenPosTable(this);
  late final $FieldClientsTable fieldClients = $FieldClientsTable(this);
  late final $FieldRecentTimesheetsTable fieldRecentTimesheets =
      $FieldRecentTimesheetsTable(this);
  late final $FieldRapItemsTable fieldRapItems = $FieldRapItemsTable(this);
  late final $FieldResourceTypesTable fieldResourceTypes =
      $FieldResourceTypesTable(this);
  late final $FieldServiceTypesTable fieldServiceTypes =
      $FieldServiceTypesTable(this);
  @override
  Iterable<TableInfo<Table, Object?>> get allTables =>
      allSchemaEntities.whereType<TableInfo<Table, Object?>>();
  @override
  List<DatabaseSchemaEntity> get allSchemaEntities => [
    localDrafts,
    localLines,
    localReceipts,
    mediaBlobs,
    outbox,
    kvEntries,
    localProgressReports,
    localFieldReports,
    fieldUnits,
    fieldContractUnits,
    fieldOpenPos,
    fieldClients,
    fieldRecentTimesheets,
    fieldRapItems,
    fieldResourceTypes,
    fieldServiceTypes,
  ];
}

typedef $$LocalDraftsTableCreateCompanionBuilder =
    LocalDraftsCompanion Function({
      required String clientUuid,
      required String userSub,
      Value<int?> companyId,
      required String type,
      Value<String> title,
      Value<int?> projectId,
      Value<int?> costCenterId,
      Value<String?> neededDate,
      Value<int?> urgencyLevelId,
      Value<String?> notes,
      Value<String> requesterIdsJson,
      Value<int?> bankAccountId,
      Value<String?> vendorJson,
      Value<int?> serverId,
      Value<int?> serverRev,
      Value<String> syncState,
      Value<String?> lastError,
      Value<String?> conflictCopyJson,
      Value<bool> deleted,
      required DateTime createdAt,
      required DateTime updatedAt,
      Value<int> rowid,
    });
typedef $$LocalDraftsTableUpdateCompanionBuilder =
    LocalDraftsCompanion Function({
      Value<String> clientUuid,
      Value<String> userSub,
      Value<int?> companyId,
      Value<String> type,
      Value<String> title,
      Value<int?> projectId,
      Value<int?> costCenterId,
      Value<String?> neededDate,
      Value<int?> urgencyLevelId,
      Value<String?> notes,
      Value<String> requesterIdsJson,
      Value<int?> bankAccountId,
      Value<String?> vendorJson,
      Value<int?> serverId,
      Value<int?> serverRev,
      Value<String> syncState,
      Value<String?> lastError,
      Value<String?> conflictCopyJson,
      Value<bool> deleted,
      Value<DateTime> createdAt,
      Value<DateTime> updatedAt,
      Value<int> rowid,
    });

final class $$LocalDraftsTableReferences
    extends BaseReferences<_$AppDatabase, $LocalDraftsTable, LocalDraft> {
  $$LocalDraftsTableReferences(super.$_db, super.$_table, super.$_typedResult);

  static MultiTypedResultKey<$LocalLinesTable, List<LocalLine>>
  _localLinesRefsTable(_$AppDatabase db) => MultiTypedResultKey.fromTable(
    db.localLines,
    aliasName: 'local_drafts__client_uuid__local_lines__draft_uuid',
  );

  $$LocalLinesTableProcessedTableManager get localLinesRefs {
    final manager = $$LocalLinesTableTableManager($_db, $_db.localLines).filter(
      (f) => f.draftUuid.clientUuid.sqlEquals(
        $_itemColumn<String>('client_uuid')!,
      ),
    );

    final cache = $_typedResult.readTableOrNull(_localLinesRefsTable($_db));
    return ProcessedTableManager(
      manager.$state.copyWith(prefetchedData: cache),
    );
  }

  static MultiTypedResultKey<$LocalReceiptsTable, List<LocalReceipt>>
  _localReceiptsRefsTable(_$AppDatabase db) => MultiTypedResultKey.fromTable(
    db.localReceipts,
    aliasName: 'local_drafts__client_uuid__local_receipts__draft_uuid',
  );

  $$LocalReceiptsTableProcessedTableManager get localReceiptsRefs {
    final manager = $$LocalReceiptsTableTableManager($_db, $_db.localReceipts)
        .filter(
          (f) => f.draftUuid.clientUuid.sqlEquals(
            $_itemColumn<String>('client_uuid')!,
          ),
        );

    final cache = $_typedResult.readTableOrNull(_localReceiptsRefsTable($_db));
    return ProcessedTableManager(
      manager.$state.copyWith(prefetchedData: cache),
    );
  }
}

class $$LocalDraftsTableFilterComposer
    extends Composer<_$AppDatabase, $LocalDraftsTable> {
  $$LocalDraftsTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get clientUuid => $composableBuilder(
    column: $table.clientUuid,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get userSub => $composableBuilder(
    column: $table.userSub,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get companyId => $composableBuilder(
    column: $table.companyId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get type => $composableBuilder(
    column: $table.type,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get title => $composableBuilder(
    column: $table.title,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get projectId => $composableBuilder(
    column: $table.projectId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get costCenterId => $composableBuilder(
    column: $table.costCenterId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get neededDate => $composableBuilder(
    column: $table.neededDate,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get urgencyLevelId => $composableBuilder(
    column: $table.urgencyLevelId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get notes => $composableBuilder(
    column: $table.notes,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get requesterIdsJson => $composableBuilder(
    column: $table.requesterIdsJson,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get bankAccountId => $composableBuilder(
    column: $table.bankAccountId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get vendorJson => $composableBuilder(
    column: $table.vendorJson,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get serverId => $composableBuilder(
    column: $table.serverId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get serverRev => $composableBuilder(
    column: $table.serverRev,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get syncState => $composableBuilder(
    column: $table.syncState,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get lastError => $composableBuilder(
    column: $table.lastError,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get conflictCopyJson => $composableBuilder(
    column: $table.conflictCopyJson,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<bool> get deleted => $composableBuilder(
    column: $table.deleted,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<DateTime> get createdAt => $composableBuilder(
    column: $table.createdAt,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<DateTime> get updatedAt => $composableBuilder(
    column: $table.updatedAt,
    builder: (column) => ColumnFilters(column),
  );

  Expression<bool> localLinesRefs(
    Expression<bool> Function($$LocalLinesTableFilterComposer f) f,
  ) {
    final $$LocalLinesTableFilterComposer composer = $composerBuilder(
      composer: this,
      getCurrentColumn: (t) => t.clientUuid,
      referencedTable: $db.localLines,
      getReferencedColumn: (t) => t.draftUuid,
      builder:
          (
            joinBuilder, {
            $addJoinBuilderToRootComposer,
            $removeJoinBuilderFromRootComposer,
          }) => $$LocalLinesTableFilterComposer(
            $db: $db,
            $table: $db.localLines,
            $addJoinBuilderToRootComposer: $addJoinBuilderToRootComposer,
            joinBuilder: joinBuilder,
            $removeJoinBuilderFromRootComposer:
                $removeJoinBuilderFromRootComposer,
          ),
    );
    return f(composer);
  }

  Expression<bool> localReceiptsRefs(
    Expression<bool> Function($$LocalReceiptsTableFilterComposer f) f,
  ) {
    final $$LocalReceiptsTableFilterComposer composer = $composerBuilder(
      composer: this,
      getCurrentColumn: (t) => t.clientUuid,
      referencedTable: $db.localReceipts,
      getReferencedColumn: (t) => t.draftUuid,
      builder:
          (
            joinBuilder, {
            $addJoinBuilderToRootComposer,
            $removeJoinBuilderFromRootComposer,
          }) => $$LocalReceiptsTableFilterComposer(
            $db: $db,
            $table: $db.localReceipts,
            $addJoinBuilderToRootComposer: $addJoinBuilderToRootComposer,
            joinBuilder: joinBuilder,
            $removeJoinBuilderFromRootComposer:
                $removeJoinBuilderFromRootComposer,
          ),
    );
    return f(composer);
  }
}

class $$LocalDraftsTableOrderingComposer
    extends Composer<_$AppDatabase, $LocalDraftsTable> {
  $$LocalDraftsTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get clientUuid => $composableBuilder(
    column: $table.clientUuid,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get userSub => $composableBuilder(
    column: $table.userSub,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get companyId => $composableBuilder(
    column: $table.companyId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get type => $composableBuilder(
    column: $table.type,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get title => $composableBuilder(
    column: $table.title,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get projectId => $composableBuilder(
    column: $table.projectId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get costCenterId => $composableBuilder(
    column: $table.costCenterId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get neededDate => $composableBuilder(
    column: $table.neededDate,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get urgencyLevelId => $composableBuilder(
    column: $table.urgencyLevelId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get notes => $composableBuilder(
    column: $table.notes,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get requesterIdsJson => $composableBuilder(
    column: $table.requesterIdsJson,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get bankAccountId => $composableBuilder(
    column: $table.bankAccountId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get vendorJson => $composableBuilder(
    column: $table.vendorJson,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get serverId => $composableBuilder(
    column: $table.serverId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get serverRev => $composableBuilder(
    column: $table.serverRev,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get syncState => $composableBuilder(
    column: $table.syncState,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get lastError => $composableBuilder(
    column: $table.lastError,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get conflictCopyJson => $composableBuilder(
    column: $table.conflictCopyJson,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<bool> get deleted => $composableBuilder(
    column: $table.deleted,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<DateTime> get createdAt => $composableBuilder(
    column: $table.createdAt,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<DateTime> get updatedAt => $composableBuilder(
    column: $table.updatedAt,
    builder: (column) => ColumnOrderings(column),
  );
}

class $$LocalDraftsTableAnnotationComposer
    extends Composer<_$AppDatabase, $LocalDraftsTable> {
  $$LocalDraftsTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get clientUuid => $composableBuilder(
    column: $table.clientUuid,
    builder: (column) => column,
  );

  GeneratedColumn<String> get userSub =>
      $composableBuilder(column: $table.userSub, builder: (column) => column);

  GeneratedColumn<int> get companyId =>
      $composableBuilder(column: $table.companyId, builder: (column) => column);

  GeneratedColumn<String> get type =>
      $composableBuilder(column: $table.type, builder: (column) => column);

  GeneratedColumn<String> get title =>
      $composableBuilder(column: $table.title, builder: (column) => column);

  GeneratedColumn<int> get projectId =>
      $composableBuilder(column: $table.projectId, builder: (column) => column);

  GeneratedColumn<int> get costCenterId => $composableBuilder(
    column: $table.costCenterId,
    builder: (column) => column,
  );

  GeneratedColumn<String> get neededDate => $composableBuilder(
    column: $table.neededDate,
    builder: (column) => column,
  );

  GeneratedColumn<int> get urgencyLevelId => $composableBuilder(
    column: $table.urgencyLevelId,
    builder: (column) => column,
  );

  GeneratedColumn<String> get notes =>
      $composableBuilder(column: $table.notes, builder: (column) => column);

  GeneratedColumn<String> get requesterIdsJson => $composableBuilder(
    column: $table.requesterIdsJson,
    builder: (column) => column,
  );

  GeneratedColumn<int> get bankAccountId => $composableBuilder(
    column: $table.bankAccountId,
    builder: (column) => column,
  );

  GeneratedColumn<String> get vendorJson => $composableBuilder(
    column: $table.vendorJson,
    builder: (column) => column,
  );

  GeneratedColumn<int> get serverId =>
      $composableBuilder(column: $table.serverId, builder: (column) => column);

  GeneratedColumn<int> get serverRev =>
      $composableBuilder(column: $table.serverRev, builder: (column) => column);

  GeneratedColumn<String> get syncState =>
      $composableBuilder(column: $table.syncState, builder: (column) => column);

  GeneratedColumn<String> get lastError =>
      $composableBuilder(column: $table.lastError, builder: (column) => column);

  GeneratedColumn<String> get conflictCopyJson => $composableBuilder(
    column: $table.conflictCopyJson,
    builder: (column) => column,
  );

  GeneratedColumn<bool> get deleted =>
      $composableBuilder(column: $table.deleted, builder: (column) => column);

  GeneratedColumn<DateTime> get createdAt =>
      $composableBuilder(column: $table.createdAt, builder: (column) => column);

  GeneratedColumn<DateTime> get updatedAt =>
      $composableBuilder(column: $table.updatedAt, builder: (column) => column);

  Expression<T> localLinesRefs<T extends Object>(
    Expression<T> Function($$LocalLinesTableAnnotationComposer a) f,
  ) {
    final $$LocalLinesTableAnnotationComposer composer = $composerBuilder(
      composer: this,
      getCurrentColumn: (t) => t.clientUuid,
      referencedTable: $db.localLines,
      getReferencedColumn: (t) => t.draftUuid,
      builder:
          (
            joinBuilder, {
            $addJoinBuilderToRootComposer,
            $removeJoinBuilderFromRootComposer,
          }) => $$LocalLinesTableAnnotationComposer(
            $db: $db,
            $table: $db.localLines,
            $addJoinBuilderToRootComposer: $addJoinBuilderToRootComposer,
            joinBuilder: joinBuilder,
            $removeJoinBuilderFromRootComposer:
                $removeJoinBuilderFromRootComposer,
          ),
    );
    return f(composer);
  }

  Expression<T> localReceiptsRefs<T extends Object>(
    Expression<T> Function($$LocalReceiptsTableAnnotationComposer a) f,
  ) {
    final $$LocalReceiptsTableAnnotationComposer composer = $composerBuilder(
      composer: this,
      getCurrentColumn: (t) => t.clientUuid,
      referencedTable: $db.localReceipts,
      getReferencedColumn: (t) => t.draftUuid,
      builder:
          (
            joinBuilder, {
            $addJoinBuilderToRootComposer,
            $removeJoinBuilderFromRootComposer,
          }) => $$LocalReceiptsTableAnnotationComposer(
            $db: $db,
            $table: $db.localReceipts,
            $addJoinBuilderToRootComposer: $addJoinBuilderToRootComposer,
            joinBuilder: joinBuilder,
            $removeJoinBuilderFromRootComposer:
                $removeJoinBuilderFromRootComposer,
          ),
    );
    return f(composer);
  }
}

class $$LocalDraftsTableTableManager
    extends
        RootTableManager<
          _$AppDatabase,
          $LocalDraftsTable,
          LocalDraft,
          $$LocalDraftsTableFilterComposer,
          $$LocalDraftsTableOrderingComposer,
          $$LocalDraftsTableAnnotationComposer,
          $$LocalDraftsTableCreateCompanionBuilder,
          $$LocalDraftsTableUpdateCompanionBuilder,
          (LocalDraft, $$LocalDraftsTableReferences),
          LocalDraft,
          PrefetchHooks Function({bool localLinesRefs, bool localReceiptsRefs})
        > {
  $$LocalDraftsTableTableManager(_$AppDatabase db, $LocalDraftsTable table)
    : super(
        TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$LocalDraftsTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$LocalDraftsTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$LocalDraftsTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback:
              ({
                Value<String> clientUuid = const Value.absent(),
                Value<String> userSub = const Value.absent(),
                Value<int?> companyId = const Value.absent(),
                Value<String> type = const Value.absent(),
                Value<String> title = const Value.absent(),
                Value<int?> projectId = const Value.absent(),
                Value<int?> costCenterId = const Value.absent(),
                Value<String?> neededDate = const Value.absent(),
                Value<int?> urgencyLevelId = const Value.absent(),
                Value<String?> notes = const Value.absent(),
                Value<String> requesterIdsJson = const Value.absent(),
                Value<int?> bankAccountId = const Value.absent(),
                Value<String?> vendorJson = const Value.absent(),
                Value<int?> serverId = const Value.absent(),
                Value<int?> serverRev = const Value.absent(),
                Value<String> syncState = const Value.absent(),
                Value<String?> lastError = const Value.absent(),
                Value<String?> conflictCopyJson = const Value.absent(),
                Value<bool> deleted = const Value.absent(),
                Value<DateTime> createdAt = const Value.absent(),
                Value<DateTime> updatedAt = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => LocalDraftsCompanion(
                clientUuid: clientUuid,
                userSub: userSub,
                companyId: companyId,
                type: type,
                title: title,
                projectId: projectId,
                costCenterId: costCenterId,
                neededDate: neededDate,
                urgencyLevelId: urgencyLevelId,
                notes: notes,
                requesterIdsJson: requesterIdsJson,
                bankAccountId: bankAccountId,
                vendorJson: vendorJson,
                serverId: serverId,
                serverRev: serverRev,
                syncState: syncState,
                lastError: lastError,
                conflictCopyJson: conflictCopyJson,
                deleted: deleted,
                createdAt: createdAt,
                updatedAt: updatedAt,
                rowid: rowid,
              ),
          createCompanionCallback:
              ({
                required String clientUuid,
                required String userSub,
                Value<int?> companyId = const Value.absent(),
                required String type,
                Value<String> title = const Value.absent(),
                Value<int?> projectId = const Value.absent(),
                Value<int?> costCenterId = const Value.absent(),
                Value<String?> neededDate = const Value.absent(),
                Value<int?> urgencyLevelId = const Value.absent(),
                Value<String?> notes = const Value.absent(),
                Value<String> requesterIdsJson = const Value.absent(),
                Value<int?> bankAccountId = const Value.absent(),
                Value<String?> vendorJson = const Value.absent(),
                Value<int?> serverId = const Value.absent(),
                Value<int?> serverRev = const Value.absent(),
                Value<String> syncState = const Value.absent(),
                Value<String?> lastError = const Value.absent(),
                Value<String?> conflictCopyJson = const Value.absent(),
                Value<bool> deleted = const Value.absent(),
                required DateTime createdAt,
                required DateTime updatedAt,
                Value<int> rowid = const Value.absent(),
              }) => LocalDraftsCompanion.insert(
                clientUuid: clientUuid,
                userSub: userSub,
                companyId: companyId,
                type: type,
                title: title,
                projectId: projectId,
                costCenterId: costCenterId,
                neededDate: neededDate,
                urgencyLevelId: urgencyLevelId,
                notes: notes,
                requesterIdsJson: requesterIdsJson,
                bankAccountId: bankAccountId,
                vendorJson: vendorJson,
                serverId: serverId,
                serverRev: serverRev,
                syncState: syncState,
                lastError: lastError,
                conflictCopyJson: conflictCopyJson,
                deleted: deleted,
                createdAt: createdAt,
                updatedAt: updatedAt,
                rowid: rowid,
              ),
          withReferenceMapper: (p0) => p0
              .map(
                (e) => (
                  e.readTable<$LocalDraftsTable, LocalDraft>(table),
                  $$LocalDraftsTableReferences(db, table, e),
                ),
              )
              .toList(),
          prefetchHooksCallback:
              ({localLinesRefs = false, localReceiptsRefs = false}) {
                return PrefetchHooks(
                  db: db,
                  explicitlyWatchedTables: [
                    if (localLinesRefs) db.localLines,
                    if (localReceiptsRefs) db.localReceipts,
                  ],
                  addJoins: null,
                  getPrefetchedDataCallback: (items) async {
                    return [
                      if (localLinesRefs)
                        await $_getPrefetchedData<
                          LocalDraft,
                          $LocalDraftsTable,
                          LocalLine
                        >(
                          currentTable: table,
                          referencedTable: $$LocalDraftsTableReferences
                              ._localLinesRefsTable(db),
                          managerFromTypedResult: (p0) =>
                              $$LocalDraftsTableReferences(
                                db,
                                table,
                                p0,
                              ).localLinesRefs,
                          referencedItemsForCurrentItem:
                              (item, referencedItems) => referencedItems.where(
                                (e) => e.draftUuid == item.clientUuid,
                              ),
                          typedResults: items,
                        ),
                      if (localReceiptsRefs)
                        await $_getPrefetchedData<
                          LocalDraft,
                          $LocalDraftsTable,
                          LocalReceipt
                        >(
                          currentTable: table,
                          referencedTable: $$LocalDraftsTableReferences
                              ._localReceiptsRefsTable(db),
                          managerFromTypedResult: (p0) =>
                              $$LocalDraftsTableReferences(
                                db,
                                table,
                                p0,
                              ).localReceiptsRefs,
                          referencedItemsForCurrentItem:
                              (item, referencedItems) => referencedItems.where(
                                (e) => e.draftUuid == item.clientUuid,
                              ),
                          typedResults: items,
                        ),
                    ];
                  },
                );
              },
        ),
      );
}

typedef $$LocalDraftsTableProcessedTableManager =
    ProcessedTableManager<
      _$AppDatabase,
      $LocalDraftsTable,
      LocalDraft,
      $$LocalDraftsTableFilterComposer,
      $$LocalDraftsTableOrderingComposer,
      $$LocalDraftsTableAnnotationComposer,
      $$LocalDraftsTableCreateCompanionBuilder,
      $$LocalDraftsTableUpdateCompanionBuilder,
      (LocalDraft, $$LocalDraftsTableReferences),
      LocalDraft,
      PrefetchHooks Function({bool localLinesRefs, bool localReceiptsRefs})
    >;
typedef $$LocalLinesTableCreateCompanionBuilder = LocalLinesCompanion Function({
  required String clientUuid,
  required String draftUuid,
  required int no,
  Value<String> description,
  Value<double?> qty,
  Value<int?> uomId,
  Value<int?> unitPrice,
  Value<int?> total,
  Value<int?> receiptAmount,
  Value<int?> rapItemId,
  Value<int?> categoryId,
  Value<int?> vehicleId,
  Value<String?> notes,
  Value<int> rowid,
});
typedef $$LocalLinesTableUpdateCompanionBuilder = LocalLinesCompanion Function({
  Value<String> clientUuid,
  Value<String> draftUuid,
  Value<int> no,
  Value<String> description,
  Value<double?> qty,
  Value<int?> uomId,
  Value<int?> unitPrice,
  Value<int?> total,
  Value<int?> receiptAmount,
  Value<int?> rapItemId,
  Value<int?> categoryId,
  Value<int?> vehicleId,
  Value<String?> notes,
  Value<int> rowid,
});

final class $$LocalLinesTableReferences
    extends BaseReferences<_$AppDatabase, $LocalLinesTable, LocalLine> {
  $$LocalLinesTableReferences(super.$_db, super.$_table, super.$_typedResult);

  static $LocalDraftsTable _draftUuidTable(_$AppDatabase db) => db.localDrafts
      .createAlias('local_lines__draft_uuid__local_drafts__client_uuid');

  $$LocalDraftsTableProcessedTableManager get draftUuid {
    final $_column = $_itemColumn<String>('draft_uuid')!;

    final manager = $$LocalDraftsTableTableManager(
      $_db,
      $_db.localDrafts,
    ).filter((f) => f.clientUuid.sqlEquals($_column));
    final item = $_typedResult.readTableOrNull(_draftUuidTable($_db));
    if (item == null) return manager;
    return ProcessedTableManager(
      manager.$state.copyWith(prefetchedData: [item]),
    );
  }

  static MultiTypedResultKey<$LocalReceiptsTable, List<LocalReceipt>>
  _localReceiptsRefsTable(_$AppDatabase db) => MultiTypedResultKey.fromTable(
    db.localReceipts,
    aliasName: 'local_lines__client_uuid__local_receipts__line_uuid',
  );

  $$LocalReceiptsTableProcessedTableManager get localReceiptsRefs {
    final manager = $$LocalReceiptsTableTableManager($_db, $_db.localReceipts)
        .filter(
          (f) => f.lineUuid.clientUuid.sqlEquals(
            $_itemColumn<String>('client_uuid')!,
          ),
        );

    final cache = $_typedResult.readTableOrNull(_localReceiptsRefsTable($_db));
    return ProcessedTableManager(
      manager.$state.copyWith(prefetchedData: cache),
    );
  }
}

class $$LocalLinesTableFilterComposer
    extends Composer<_$AppDatabase, $LocalLinesTable> {
  $$LocalLinesTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get clientUuid => $composableBuilder(
    column: $table.clientUuid,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get no => $composableBuilder(
    column: $table.no,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get description => $composableBuilder(
    column: $table.description,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<double> get qty => $composableBuilder(
    column: $table.qty,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get uomId => $composableBuilder(
    column: $table.uomId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get unitPrice => $composableBuilder(
    column: $table.unitPrice,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get total => $composableBuilder(
    column: $table.total,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get receiptAmount => $composableBuilder(
    column: $table.receiptAmount,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get rapItemId => $composableBuilder(
    column: $table.rapItemId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get categoryId => $composableBuilder(
    column: $table.categoryId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get vehicleId => $composableBuilder(
    column: $table.vehicleId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get notes => $composableBuilder(
    column: $table.notes,
    builder: (column) => ColumnFilters(column),
  );

  $$LocalDraftsTableFilterComposer get draftUuid {
    final $$LocalDraftsTableFilterComposer composer = $composerBuilder(
      composer: this,
      getCurrentColumn: (t) => t.draftUuid,
      referencedTable: $db.localDrafts,
      getReferencedColumn: (t) => t.clientUuid,
      builder:
          (
            joinBuilder, {
            $addJoinBuilderToRootComposer,
            $removeJoinBuilderFromRootComposer,
          }) => $$LocalDraftsTableFilterComposer(
            $db: $db,
            $table: $db.localDrafts,
            $addJoinBuilderToRootComposer: $addJoinBuilderToRootComposer,
            joinBuilder: joinBuilder,
            $removeJoinBuilderFromRootComposer:
                $removeJoinBuilderFromRootComposer,
          ),
    );
    return composer;
  }

  Expression<bool> localReceiptsRefs(
    Expression<bool> Function($$LocalReceiptsTableFilterComposer f) f,
  ) {
    final $$LocalReceiptsTableFilterComposer composer = $composerBuilder(
      composer: this,
      getCurrentColumn: (t) => t.clientUuid,
      referencedTable: $db.localReceipts,
      getReferencedColumn: (t) => t.lineUuid,
      builder:
          (
            joinBuilder, {
            $addJoinBuilderToRootComposer,
            $removeJoinBuilderFromRootComposer,
          }) => $$LocalReceiptsTableFilterComposer(
            $db: $db,
            $table: $db.localReceipts,
            $addJoinBuilderToRootComposer: $addJoinBuilderToRootComposer,
            joinBuilder: joinBuilder,
            $removeJoinBuilderFromRootComposer:
                $removeJoinBuilderFromRootComposer,
          ),
    );
    return f(composer);
  }
}

class $$LocalLinesTableOrderingComposer
    extends Composer<_$AppDatabase, $LocalLinesTable> {
  $$LocalLinesTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get clientUuid => $composableBuilder(
    column: $table.clientUuid,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get no => $composableBuilder(
    column: $table.no,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get description => $composableBuilder(
    column: $table.description,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<double> get qty => $composableBuilder(
    column: $table.qty,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get uomId => $composableBuilder(
    column: $table.uomId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get unitPrice => $composableBuilder(
    column: $table.unitPrice,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get total => $composableBuilder(
    column: $table.total,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get receiptAmount => $composableBuilder(
    column: $table.receiptAmount,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get rapItemId => $composableBuilder(
    column: $table.rapItemId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get categoryId => $composableBuilder(
    column: $table.categoryId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get vehicleId => $composableBuilder(
    column: $table.vehicleId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get notes => $composableBuilder(
    column: $table.notes,
    builder: (column) => ColumnOrderings(column),
  );

  $$LocalDraftsTableOrderingComposer get draftUuid {
    final $$LocalDraftsTableOrderingComposer composer = $composerBuilder(
      composer: this,
      getCurrentColumn: (t) => t.draftUuid,
      referencedTable: $db.localDrafts,
      getReferencedColumn: (t) => t.clientUuid,
      builder:
          (
            joinBuilder, {
            $addJoinBuilderToRootComposer,
            $removeJoinBuilderFromRootComposer,
          }) => $$LocalDraftsTableOrderingComposer(
            $db: $db,
            $table: $db.localDrafts,
            $addJoinBuilderToRootComposer: $addJoinBuilderToRootComposer,
            joinBuilder: joinBuilder,
            $removeJoinBuilderFromRootComposer:
                $removeJoinBuilderFromRootComposer,
          ),
    );
    return composer;
  }
}

class $$LocalLinesTableAnnotationComposer
    extends Composer<_$AppDatabase, $LocalLinesTable> {
  $$LocalLinesTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get clientUuid => $composableBuilder(
    column: $table.clientUuid,
    builder: (column) => column,
  );

  GeneratedColumn<int> get no =>
      $composableBuilder(column: $table.no, builder: (column) => column);

  GeneratedColumn<String> get description => $composableBuilder(
    column: $table.description,
    builder: (column) => column,
  );

  GeneratedColumn<double> get qty =>
      $composableBuilder(column: $table.qty, builder: (column) => column);

  GeneratedColumn<int> get uomId =>
      $composableBuilder(column: $table.uomId, builder: (column) => column);

  GeneratedColumn<int> get unitPrice =>
      $composableBuilder(column: $table.unitPrice, builder: (column) => column);

  GeneratedColumn<int> get total =>
      $composableBuilder(column: $table.total, builder: (column) => column);

  GeneratedColumn<int> get receiptAmount => $composableBuilder(
    column: $table.receiptAmount,
    builder: (column) => column,
  );

  GeneratedColumn<int> get rapItemId =>
      $composableBuilder(column: $table.rapItemId, builder: (column) => column);

  GeneratedColumn<int> get categoryId => $composableBuilder(
    column: $table.categoryId,
    builder: (column) => column,
  );

  GeneratedColumn<int> get vehicleId =>
      $composableBuilder(column: $table.vehicleId, builder: (column) => column);

  GeneratedColumn<String> get notes =>
      $composableBuilder(column: $table.notes, builder: (column) => column);

  $$LocalDraftsTableAnnotationComposer get draftUuid {
    final $$LocalDraftsTableAnnotationComposer composer = $composerBuilder(
      composer: this,
      getCurrentColumn: (t) => t.draftUuid,
      referencedTable: $db.localDrafts,
      getReferencedColumn: (t) => t.clientUuid,
      builder:
          (
            joinBuilder, {
            $addJoinBuilderToRootComposer,
            $removeJoinBuilderFromRootComposer,
          }) => $$LocalDraftsTableAnnotationComposer(
            $db: $db,
            $table: $db.localDrafts,
            $addJoinBuilderToRootComposer: $addJoinBuilderToRootComposer,
            joinBuilder: joinBuilder,
            $removeJoinBuilderFromRootComposer:
                $removeJoinBuilderFromRootComposer,
          ),
    );
    return composer;
  }

  Expression<T> localReceiptsRefs<T extends Object>(
    Expression<T> Function($$LocalReceiptsTableAnnotationComposer a) f,
  ) {
    final $$LocalReceiptsTableAnnotationComposer composer = $composerBuilder(
      composer: this,
      getCurrentColumn: (t) => t.clientUuid,
      referencedTable: $db.localReceipts,
      getReferencedColumn: (t) => t.lineUuid,
      builder:
          (
            joinBuilder, {
            $addJoinBuilderToRootComposer,
            $removeJoinBuilderFromRootComposer,
          }) => $$LocalReceiptsTableAnnotationComposer(
            $db: $db,
            $table: $db.localReceipts,
            $addJoinBuilderToRootComposer: $addJoinBuilderToRootComposer,
            joinBuilder: joinBuilder,
            $removeJoinBuilderFromRootComposer:
                $removeJoinBuilderFromRootComposer,
          ),
    );
    return f(composer);
  }
}

class $$LocalLinesTableTableManager
    extends
        RootTableManager<
          _$AppDatabase,
          $LocalLinesTable,
          LocalLine,
          $$LocalLinesTableFilterComposer,
          $$LocalLinesTableOrderingComposer,
          $$LocalLinesTableAnnotationComposer,
          $$LocalLinesTableCreateCompanionBuilder,
          $$LocalLinesTableUpdateCompanionBuilder,
          (LocalLine, $$LocalLinesTableReferences),
          LocalLine,
          PrefetchHooks Function({bool draftUuid, bool localReceiptsRefs})
        > {
  $$LocalLinesTableTableManager(_$AppDatabase db, $LocalLinesTable table)
    : super(
        TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$LocalLinesTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$LocalLinesTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$LocalLinesTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback:
              ({
                Value<String> clientUuid = const Value.absent(),
                Value<String> draftUuid = const Value.absent(),
                Value<int> no = const Value.absent(),
                Value<String> description = const Value.absent(),
                Value<double?> qty = const Value.absent(),
                Value<int?> uomId = const Value.absent(),
                Value<int?> unitPrice = const Value.absent(),
                Value<int?> total = const Value.absent(),
                Value<int?> receiptAmount = const Value.absent(),
                Value<int?> rapItemId = const Value.absent(),
                Value<int?> categoryId = const Value.absent(),
                Value<int?> vehicleId = const Value.absent(),
                Value<String?> notes = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => LocalLinesCompanion(
                clientUuid: clientUuid,
                draftUuid: draftUuid,
                no: no,
                description: description,
                qty: qty,
                uomId: uomId,
                unitPrice: unitPrice,
                total: total,
                receiptAmount: receiptAmount,
                rapItemId: rapItemId,
                categoryId: categoryId,
                vehicleId: vehicleId,
                notes: notes,
                rowid: rowid,
              ),
          createCompanionCallback:
              ({
                required String clientUuid,
                required String draftUuid,
                required int no,
                Value<String> description = const Value.absent(),
                Value<double?> qty = const Value.absent(),
                Value<int?> uomId = const Value.absent(),
                Value<int?> unitPrice = const Value.absent(),
                Value<int?> total = const Value.absent(),
                Value<int?> receiptAmount = const Value.absent(),
                Value<int?> rapItemId = const Value.absent(),
                Value<int?> categoryId = const Value.absent(),
                Value<int?> vehicleId = const Value.absent(),
                Value<String?> notes = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => LocalLinesCompanion.insert(
                clientUuid: clientUuid,
                draftUuid: draftUuid,
                no: no,
                description: description,
                qty: qty,
                uomId: uomId,
                unitPrice: unitPrice,
                total: total,
                receiptAmount: receiptAmount,
                rapItemId: rapItemId,
                categoryId: categoryId,
                vehicleId: vehicleId,
                notes: notes,
                rowid: rowid,
              ),
          withReferenceMapper: (p0) => p0
              .map(
                (e) => (
                  e.readTable<$LocalLinesTable, LocalLine>(table),
                  $$LocalLinesTableReferences(db, table, e),
                ),
              )
              .toList(),
          prefetchHooksCallback:
              ({draftUuid = false, localReceiptsRefs = false}) {
                return PrefetchHooks(
                  db: db,
                  explicitlyWatchedTables: [
                    if (localReceiptsRefs) db.localReceipts,
                  ],
                  addJoins:
                      <
                        T extends TableManagerState<
                          dynamic,
                          dynamic,
                          dynamic,
                          dynamic,
                          dynamic,
                          dynamic,
                          dynamic,
                          dynamic,
                          dynamic,
                          dynamic,
                          dynamic
                        >
                      >(state) {
                        if (draftUuid) {
                          state = state.withJoin(
                            currentTable: table,
                            currentColumn: table.draftUuid,
                            referencedTable: $$LocalLinesTableReferences
                                ._draftUuidTable(db),
                            referencedColumn: $$LocalLinesTableReferences
                                ._draftUuidTable(db)
                                .clientUuid,
                          ) as T;
                        }

                        return state;
                      },
                  getPrefetchedDataCallback: (items) async {
                    return [
                      if (localReceiptsRefs)
                        await $_getPrefetchedData<
                          LocalLine,
                          $LocalLinesTable,
                          LocalReceipt
                        >(
                          currentTable: table,
                          referencedTable: $$LocalLinesTableReferences
                              ._localReceiptsRefsTable(db),
                          managerFromTypedResult: (p0) =>
                              $$LocalLinesTableReferences(
                                db,
                                table,
                                p0,
                              ).localReceiptsRefs,
                          referencedItemsForCurrentItem:
                              (item, referencedItems) => referencedItems.where(
                                (e) => e.lineUuid == item.clientUuid,
                              ),
                          typedResults: items,
                        ),
                    ];
                  },
                );
              },
        ),
      );
}

typedef $$LocalLinesTableProcessedTableManager =
    ProcessedTableManager<
      _$AppDatabase,
      $LocalLinesTable,
      LocalLine,
      $$LocalLinesTableFilterComposer,
      $$LocalLinesTableOrderingComposer,
      $$LocalLinesTableAnnotationComposer,
      $$LocalLinesTableCreateCompanionBuilder,
      $$LocalLinesTableUpdateCompanionBuilder,
      (LocalLine, $$LocalLinesTableReferences),
      LocalLine,
      PrefetchHooks Function({bool draftUuid, bool localReceiptsRefs})
    >;
typedef $$LocalReceiptsTableCreateCompanionBuilder =
    LocalReceiptsCompanion Function({
      required String clientUuid,
      required String lineUuid,
      required String draftUuid,
      Value<String?> receiptNo,
      Value<String> vendorName,
      required String receiptDate,
      Value<String?> receiptTime,
      required int amount,
      required String mediaUuid,
      Value<int?> serverReceiptId,
      Value<int> rowid,
    });
typedef $$LocalReceiptsTableUpdateCompanionBuilder =
    LocalReceiptsCompanion Function({
      Value<String> clientUuid,
      Value<String> lineUuid,
      Value<String> draftUuid,
      Value<String?> receiptNo,
      Value<String> vendorName,
      Value<String> receiptDate,
      Value<String?> receiptTime,
      Value<int> amount,
      Value<String> mediaUuid,
      Value<int?> serverReceiptId,
      Value<int> rowid,
    });

final class $$LocalReceiptsTableReferences
    extends BaseReferences<_$AppDatabase, $LocalReceiptsTable, LocalReceipt> {
  $$LocalReceiptsTableReferences(
    super.$_db,
    super.$_table,
    super.$_typedResult,
  );

  static $LocalLinesTable _lineUuidTable(_$AppDatabase db) => db.localLines
      .createAlias('local_receipts__line_uuid__local_lines__client_uuid');

  $$LocalLinesTableProcessedTableManager get lineUuid {
    final $_column = $_itemColumn<String>('line_uuid')!;

    final manager = $$LocalLinesTableTableManager(
      $_db,
      $_db.localLines,
    ).filter((f) => f.clientUuid.sqlEquals($_column));
    final item = $_typedResult.readTableOrNull(_lineUuidTable($_db));
    if (item == null) return manager;
    return ProcessedTableManager(
      manager.$state.copyWith(prefetchedData: [item]),
    );
  }

  static $LocalDraftsTable _draftUuidTable(_$AppDatabase db) => db.localDrafts
      .createAlias('local_receipts__draft_uuid__local_drafts__client_uuid');

  $$LocalDraftsTableProcessedTableManager get draftUuid {
    final $_column = $_itemColumn<String>('draft_uuid')!;

    final manager = $$LocalDraftsTableTableManager(
      $_db,
      $_db.localDrafts,
    ).filter((f) => f.clientUuid.sqlEquals($_column));
    final item = $_typedResult.readTableOrNull(_draftUuidTable($_db));
    if (item == null) return manager;
    return ProcessedTableManager(
      manager.$state.copyWith(prefetchedData: [item]),
    );
  }
}

class $$LocalReceiptsTableFilterComposer
    extends Composer<_$AppDatabase, $LocalReceiptsTable> {
  $$LocalReceiptsTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get clientUuid => $composableBuilder(
    column: $table.clientUuid,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get receiptNo => $composableBuilder(
    column: $table.receiptNo,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get vendorName => $composableBuilder(
    column: $table.vendorName,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get receiptDate => $composableBuilder(
    column: $table.receiptDate,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get receiptTime => $composableBuilder(
    column: $table.receiptTime,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get amount => $composableBuilder(
    column: $table.amount,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get mediaUuid => $composableBuilder(
    column: $table.mediaUuid,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get serverReceiptId => $composableBuilder(
    column: $table.serverReceiptId,
    builder: (column) => ColumnFilters(column),
  );

  $$LocalLinesTableFilterComposer get lineUuid {
    final $$LocalLinesTableFilterComposer composer = $composerBuilder(
      composer: this,
      getCurrentColumn: (t) => t.lineUuid,
      referencedTable: $db.localLines,
      getReferencedColumn: (t) => t.clientUuid,
      builder:
          (
            joinBuilder, {
            $addJoinBuilderToRootComposer,
            $removeJoinBuilderFromRootComposer,
          }) => $$LocalLinesTableFilterComposer(
            $db: $db,
            $table: $db.localLines,
            $addJoinBuilderToRootComposer: $addJoinBuilderToRootComposer,
            joinBuilder: joinBuilder,
            $removeJoinBuilderFromRootComposer:
                $removeJoinBuilderFromRootComposer,
          ),
    );
    return composer;
  }

  $$LocalDraftsTableFilterComposer get draftUuid {
    final $$LocalDraftsTableFilterComposer composer = $composerBuilder(
      composer: this,
      getCurrentColumn: (t) => t.draftUuid,
      referencedTable: $db.localDrafts,
      getReferencedColumn: (t) => t.clientUuid,
      builder:
          (
            joinBuilder, {
            $addJoinBuilderToRootComposer,
            $removeJoinBuilderFromRootComposer,
          }) => $$LocalDraftsTableFilterComposer(
            $db: $db,
            $table: $db.localDrafts,
            $addJoinBuilderToRootComposer: $addJoinBuilderToRootComposer,
            joinBuilder: joinBuilder,
            $removeJoinBuilderFromRootComposer:
                $removeJoinBuilderFromRootComposer,
          ),
    );
    return composer;
  }
}

class $$LocalReceiptsTableOrderingComposer
    extends Composer<_$AppDatabase, $LocalReceiptsTable> {
  $$LocalReceiptsTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get clientUuid => $composableBuilder(
    column: $table.clientUuid,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get receiptNo => $composableBuilder(
    column: $table.receiptNo,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get vendorName => $composableBuilder(
    column: $table.vendorName,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get receiptDate => $composableBuilder(
    column: $table.receiptDate,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get receiptTime => $composableBuilder(
    column: $table.receiptTime,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get amount => $composableBuilder(
    column: $table.amount,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get mediaUuid => $composableBuilder(
    column: $table.mediaUuid,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get serverReceiptId => $composableBuilder(
    column: $table.serverReceiptId,
    builder: (column) => ColumnOrderings(column),
  );

  $$LocalLinesTableOrderingComposer get lineUuid {
    final $$LocalLinesTableOrderingComposer composer = $composerBuilder(
      composer: this,
      getCurrentColumn: (t) => t.lineUuid,
      referencedTable: $db.localLines,
      getReferencedColumn: (t) => t.clientUuid,
      builder:
          (
            joinBuilder, {
            $addJoinBuilderToRootComposer,
            $removeJoinBuilderFromRootComposer,
          }) => $$LocalLinesTableOrderingComposer(
            $db: $db,
            $table: $db.localLines,
            $addJoinBuilderToRootComposer: $addJoinBuilderToRootComposer,
            joinBuilder: joinBuilder,
            $removeJoinBuilderFromRootComposer:
                $removeJoinBuilderFromRootComposer,
          ),
    );
    return composer;
  }

  $$LocalDraftsTableOrderingComposer get draftUuid {
    final $$LocalDraftsTableOrderingComposer composer = $composerBuilder(
      composer: this,
      getCurrentColumn: (t) => t.draftUuid,
      referencedTable: $db.localDrafts,
      getReferencedColumn: (t) => t.clientUuid,
      builder:
          (
            joinBuilder, {
            $addJoinBuilderToRootComposer,
            $removeJoinBuilderFromRootComposer,
          }) => $$LocalDraftsTableOrderingComposer(
            $db: $db,
            $table: $db.localDrafts,
            $addJoinBuilderToRootComposer: $addJoinBuilderToRootComposer,
            joinBuilder: joinBuilder,
            $removeJoinBuilderFromRootComposer:
                $removeJoinBuilderFromRootComposer,
          ),
    );
    return composer;
  }
}

class $$LocalReceiptsTableAnnotationComposer
    extends Composer<_$AppDatabase, $LocalReceiptsTable> {
  $$LocalReceiptsTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get clientUuid => $composableBuilder(
    column: $table.clientUuid,
    builder: (column) => column,
  );

  GeneratedColumn<String> get receiptNo =>
      $composableBuilder(column: $table.receiptNo, builder: (column) => column);

  GeneratedColumn<String> get vendorName => $composableBuilder(
    column: $table.vendorName,
    builder: (column) => column,
  );

  GeneratedColumn<String> get receiptDate => $composableBuilder(
    column: $table.receiptDate,
    builder: (column) => column,
  );

  GeneratedColumn<String> get receiptTime => $composableBuilder(
    column: $table.receiptTime,
    builder: (column) => column,
  );

  GeneratedColumn<int> get amount =>
      $composableBuilder(column: $table.amount, builder: (column) => column);

  GeneratedColumn<String> get mediaUuid =>
      $composableBuilder(column: $table.mediaUuid, builder: (column) => column);

  GeneratedColumn<int> get serverReceiptId => $composableBuilder(
    column: $table.serverReceiptId,
    builder: (column) => column,
  );

  $$LocalLinesTableAnnotationComposer get lineUuid {
    final $$LocalLinesTableAnnotationComposer composer = $composerBuilder(
      composer: this,
      getCurrentColumn: (t) => t.lineUuid,
      referencedTable: $db.localLines,
      getReferencedColumn: (t) => t.clientUuid,
      builder:
          (
            joinBuilder, {
            $addJoinBuilderToRootComposer,
            $removeJoinBuilderFromRootComposer,
          }) => $$LocalLinesTableAnnotationComposer(
            $db: $db,
            $table: $db.localLines,
            $addJoinBuilderToRootComposer: $addJoinBuilderToRootComposer,
            joinBuilder: joinBuilder,
            $removeJoinBuilderFromRootComposer:
                $removeJoinBuilderFromRootComposer,
          ),
    );
    return composer;
  }

  $$LocalDraftsTableAnnotationComposer get draftUuid {
    final $$LocalDraftsTableAnnotationComposer composer = $composerBuilder(
      composer: this,
      getCurrentColumn: (t) => t.draftUuid,
      referencedTable: $db.localDrafts,
      getReferencedColumn: (t) => t.clientUuid,
      builder:
          (
            joinBuilder, {
            $addJoinBuilderToRootComposer,
            $removeJoinBuilderFromRootComposer,
          }) => $$LocalDraftsTableAnnotationComposer(
            $db: $db,
            $table: $db.localDrafts,
            $addJoinBuilderToRootComposer: $addJoinBuilderToRootComposer,
            joinBuilder: joinBuilder,
            $removeJoinBuilderFromRootComposer:
                $removeJoinBuilderFromRootComposer,
          ),
    );
    return composer;
  }
}

class $$LocalReceiptsTableTableManager
    extends
        RootTableManager<
          _$AppDatabase,
          $LocalReceiptsTable,
          LocalReceipt,
          $$LocalReceiptsTableFilterComposer,
          $$LocalReceiptsTableOrderingComposer,
          $$LocalReceiptsTableAnnotationComposer,
          $$LocalReceiptsTableCreateCompanionBuilder,
          $$LocalReceiptsTableUpdateCompanionBuilder,
          (LocalReceipt, $$LocalReceiptsTableReferences),
          LocalReceipt,
          PrefetchHooks Function({bool lineUuid, bool draftUuid})
        > {
  $$LocalReceiptsTableTableManager(_$AppDatabase db, $LocalReceiptsTable table)
    : super(
        TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$LocalReceiptsTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$LocalReceiptsTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$LocalReceiptsTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback:
              ({
                Value<String> clientUuid = const Value.absent(),
                Value<String> lineUuid = const Value.absent(),
                Value<String> draftUuid = const Value.absent(),
                Value<String?> receiptNo = const Value.absent(),
                Value<String> vendorName = const Value.absent(),
                Value<String> receiptDate = const Value.absent(),
                Value<String?> receiptTime = const Value.absent(),
                Value<int> amount = const Value.absent(),
                Value<String> mediaUuid = const Value.absent(),
                Value<int?> serverReceiptId = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => LocalReceiptsCompanion(
                clientUuid: clientUuid,
                lineUuid: lineUuid,
                draftUuid: draftUuid,
                receiptNo: receiptNo,
                vendorName: vendorName,
                receiptDate: receiptDate,
                receiptTime: receiptTime,
                amount: amount,
                mediaUuid: mediaUuid,
                serverReceiptId: serverReceiptId,
                rowid: rowid,
              ),
          createCompanionCallback:
              ({
                required String clientUuid,
                required String lineUuid,
                required String draftUuid,
                Value<String?> receiptNo = const Value.absent(),
                Value<String> vendorName = const Value.absent(),
                required String receiptDate,
                Value<String?> receiptTime = const Value.absent(),
                required int amount,
                required String mediaUuid,
                Value<int?> serverReceiptId = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => LocalReceiptsCompanion.insert(
                clientUuid: clientUuid,
                lineUuid: lineUuid,
                draftUuid: draftUuid,
                receiptNo: receiptNo,
                vendorName: vendorName,
                receiptDate: receiptDate,
                receiptTime: receiptTime,
                amount: amount,
                mediaUuid: mediaUuid,
                serverReceiptId: serverReceiptId,
                rowid: rowid,
              ),
          withReferenceMapper: (p0) => p0
              .map(
                (e) => (
                  e.readTable<$LocalReceiptsTable, LocalReceipt>(table),
                  $$LocalReceiptsTableReferences(db, table, e),
                ),
              )
              .toList(),
          prefetchHooksCallback: ({lineUuid = false, draftUuid = false}) {
            return PrefetchHooks(
              db: db,
              explicitlyWatchedTables: [],
              addJoins:
                  <
                    T extends TableManagerState<
                      dynamic,
                      dynamic,
                      dynamic,
                      dynamic,
                      dynamic,
                      dynamic,
                      dynamic,
                      dynamic,
                      dynamic,
                      dynamic,
                      dynamic
                    >
                  >(state) {
                    if (lineUuid) {
                      state = state.withJoin(
                        currentTable: table,
                        currentColumn: table.lineUuid,
                        referencedTable: $$LocalReceiptsTableReferences
                            ._lineUuidTable(db),
                        referencedColumn: $$LocalReceiptsTableReferences
                            ._lineUuidTable(db)
                            .clientUuid,
                      ) as T;
                    }
                    if (draftUuid) {
                      state = state.withJoin(
                        currentTable: table,
                        currentColumn: table.draftUuid,
                        referencedTable: $$LocalReceiptsTableReferences
                            ._draftUuidTable(db),
                        referencedColumn: $$LocalReceiptsTableReferences
                            ._draftUuidTable(db)
                            .clientUuid,
                      ) as T;
                    }

                    return state;
                  },
              getPrefetchedDataCallback: (items) async {
                return [];
              },
            );
          },
        ),
      );
}

typedef $$LocalReceiptsTableProcessedTableManager =
    ProcessedTableManager<
      _$AppDatabase,
      $LocalReceiptsTable,
      LocalReceipt,
      $$LocalReceiptsTableFilterComposer,
      $$LocalReceiptsTableOrderingComposer,
      $$LocalReceiptsTableAnnotationComposer,
      $$LocalReceiptsTableCreateCompanionBuilder,
      $$LocalReceiptsTableUpdateCompanionBuilder,
      (LocalReceipt, $$LocalReceiptsTableReferences),
      LocalReceipt,
      PrefetchHooks Function({bool lineUuid, bool draftUuid})
    >;
typedef $$MediaBlobsTableCreateCompanionBuilder = MediaBlobsCompanion Function({
  required String clientUuid,
  required String userSub,
  required String kind,
  Value<String> mimeType,
  required Uint8List bytes,
  required String sha256,
  required int sizeBytes,
  Value<bool> uploaded,
  Value<String?> serverMediaId,
  required DateTime createdAt,
  Value<int> rowid,
});
typedef $$MediaBlobsTableUpdateCompanionBuilder = MediaBlobsCompanion Function({
  Value<String> clientUuid,
  Value<String> userSub,
  Value<String> kind,
  Value<String> mimeType,
  Value<Uint8List> bytes,
  Value<String> sha256,
  Value<int> sizeBytes,
  Value<bool> uploaded,
  Value<String?> serverMediaId,
  Value<DateTime> createdAt,
  Value<int> rowid,
});

class $$MediaBlobsTableFilterComposer
    extends Composer<_$AppDatabase, $MediaBlobsTable> {
  $$MediaBlobsTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get clientUuid => $composableBuilder(
    column: $table.clientUuid,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get userSub => $composableBuilder(
    column: $table.userSub,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get kind => $composableBuilder(
    column: $table.kind,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get mimeType => $composableBuilder(
    column: $table.mimeType,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<Uint8List> get bytes => $composableBuilder(
    column: $table.bytes,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get sha256 => $composableBuilder(
    column: $table.sha256,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get sizeBytes => $composableBuilder(
    column: $table.sizeBytes,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<bool> get uploaded => $composableBuilder(
    column: $table.uploaded,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get serverMediaId => $composableBuilder(
    column: $table.serverMediaId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<DateTime> get createdAt => $composableBuilder(
    column: $table.createdAt,
    builder: (column) => ColumnFilters(column),
  );
}

class $$MediaBlobsTableOrderingComposer
    extends Composer<_$AppDatabase, $MediaBlobsTable> {
  $$MediaBlobsTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get clientUuid => $composableBuilder(
    column: $table.clientUuid,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get userSub => $composableBuilder(
    column: $table.userSub,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get kind => $composableBuilder(
    column: $table.kind,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get mimeType => $composableBuilder(
    column: $table.mimeType,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<Uint8List> get bytes => $composableBuilder(
    column: $table.bytes,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get sha256 => $composableBuilder(
    column: $table.sha256,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get sizeBytes => $composableBuilder(
    column: $table.sizeBytes,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<bool> get uploaded => $composableBuilder(
    column: $table.uploaded,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get serverMediaId => $composableBuilder(
    column: $table.serverMediaId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<DateTime> get createdAt => $composableBuilder(
    column: $table.createdAt,
    builder: (column) => ColumnOrderings(column),
  );
}

class $$MediaBlobsTableAnnotationComposer
    extends Composer<_$AppDatabase, $MediaBlobsTable> {
  $$MediaBlobsTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get clientUuid => $composableBuilder(
    column: $table.clientUuid,
    builder: (column) => column,
  );

  GeneratedColumn<String> get userSub =>
      $composableBuilder(column: $table.userSub, builder: (column) => column);

  GeneratedColumn<String> get kind =>
      $composableBuilder(column: $table.kind, builder: (column) => column);

  GeneratedColumn<String> get mimeType =>
      $composableBuilder(column: $table.mimeType, builder: (column) => column);

  GeneratedColumn<Uint8List> get bytes =>
      $composableBuilder(column: $table.bytes, builder: (column) => column);

  GeneratedColumn<String> get sha256 =>
      $composableBuilder(column: $table.sha256, builder: (column) => column);

  GeneratedColumn<int> get sizeBytes =>
      $composableBuilder(column: $table.sizeBytes, builder: (column) => column);

  GeneratedColumn<bool> get uploaded =>
      $composableBuilder(column: $table.uploaded, builder: (column) => column);

  GeneratedColumn<String> get serverMediaId => $composableBuilder(
    column: $table.serverMediaId,
    builder: (column) => column,
  );

  GeneratedColumn<DateTime> get createdAt =>
      $composableBuilder(column: $table.createdAt, builder: (column) => column);
}

class $$MediaBlobsTableTableManager
    extends
        RootTableManager<
          _$AppDatabase,
          $MediaBlobsTable,
          MediaBlob,
          $$MediaBlobsTableFilterComposer,
          $$MediaBlobsTableOrderingComposer,
          $$MediaBlobsTableAnnotationComposer,
          $$MediaBlobsTableCreateCompanionBuilder,
          $$MediaBlobsTableUpdateCompanionBuilder,
          (
            MediaBlob,
            BaseReferences<_$AppDatabase, $MediaBlobsTable, MediaBlob>,
          ),
          MediaBlob,
          PrefetchHooks Function()
        > {
  $$MediaBlobsTableTableManager(_$AppDatabase db, $MediaBlobsTable table)
    : super(
        TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$MediaBlobsTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$MediaBlobsTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$MediaBlobsTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback:
              ({
                Value<String> clientUuid = const Value.absent(),
                Value<String> userSub = const Value.absent(),
                Value<String> kind = const Value.absent(),
                Value<String> mimeType = const Value.absent(),
                Value<Uint8List> bytes = const Value.absent(),
                Value<String> sha256 = const Value.absent(),
                Value<int> sizeBytes = const Value.absent(),
                Value<bool> uploaded = const Value.absent(),
                Value<String?> serverMediaId = const Value.absent(),
                Value<DateTime> createdAt = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => MediaBlobsCompanion(
                clientUuid: clientUuid,
                userSub: userSub,
                kind: kind,
                mimeType: mimeType,
                bytes: bytes,
                sha256: sha256,
                sizeBytes: sizeBytes,
                uploaded: uploaded,
                serverMediaId: serverMediaId,
                createdAt: createdAt,
                rowid: rowid,
              ),
          createCompanionCallback:
              ({
                required String clientUuid,
                required String userSub,
                required String kind,
                Value<String> mimeType = const Value.absent(),
                required Uint8List bytes,
                required String sha256,
                required int sizeBytes,
                Value<bool> uploaded = const Value.absent(),
                Value<String?> serverMediaId = const Value.absent(),
                required DateTime createdAt,
                Value<int> rowid = const Value.absent(),
              }) => MediaBlobsCompanion.insert(
                clientUuid: clientUuid,
                userSub: userSub,
                kind: kind,
                mimeType: mimeType,
                bytes: bytes,
                sha256: sha256,
                sizeBytes: sizeBytes,
                uploaded: uploaded,
                serverMediaId: serverMediaId,
                createdAt: createdAt,
                rowid: rowid,
              ),
          withReferenceMapper: (p0) => p0
              .map(
                (e) => (
                  e.readTable<$MediaBlobsTable, MediaBlob>(table),
                  BaseReferences<_$AppDatabase, $MediaBlobsTable, MediaBlob>(
                    db,
                    table,
                    e,
                  ),
                ),
              )
              .toList(),
          prefetchHooksCallback: null,
        ),
      );
}

typedef $$MediaBlobsTableProcessedTableManager =
    ProcessedTableManager<
      _$AppDatabase,
      $MediaBlobsTable,
      MediaBlob,
      $$MediaBlobsTableFilterComposer,
      $$MediaBlobsTableOrderingComposer,
      $$MediaBlobsTableAnnotationComposer,
      $$MediaBlobsTableCreateCompanionBuilder,
      $$MediaBlobsTableUpdateCompanionBuilder,
      (MediaBlob, BaseReferences<_$AppDatabase, $MediaBlobsTable, MediaBlob>),
      MediaBlob,
      PrefetchHooks Function()
    >;
typedef $$OutboxTableCreateCompanionBuilder = OutboxCompanion Function({
  required String opUuid,
  required String userSub,
  Value<int?> companyId,
  Value<int?> siteId,
  required String type,
  required String targetUuid,
  required String payloadJson,
  Value<int?> baseRev,
  Value<String> dependsOnJson,
  required String deviceTime,
  required int elapsedMs,
  required String bootId,
  Value<bool> offline,
  Value<String> status,
  Value<int> attempts,
  Value<DateTime?> nextAttemptAt,
  Value<String?> lastErrorCode,
  Value<String?> lastErrorMessage,
  required DateTime createdAt,
  Value<int> rowid,
});
typedef $$OutboxTableUpdateCompanionBuilder = OutboxCompanion Function({
  Value<String> opUuid,
  Value<String> userSub,
  Value<int?> companyId,
  Value<int?> siteId,
  Value<String> type,
  Value<String> targetUuid,
  Value<String> payloadJson,
  Value<int?> baseRev,
  Value<String> dependsOnJson,
  Value<String> deviceTime,
  Value<int> elapsedMs,
  Value<String> bootId,
  Value<bool> offline,
  Value<String> status,
  Value<int> attempts,
  Value<DateTime?> nextAttemptAt,
  Value<String?> lastErrorCode,
  Value<String?> lastErrorMessage,
  Value<DateTime> createdAt,
  Value<int> rowid,
});

class $$OutboxTableFilterComposer
    extends Composer<_$AppDatabase, $OutboxTable> {
  $$OutboxTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get opUuid => $composableBuilder(
    column: $table.opUuid,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get userSub => $composableBuilder(
    column: $table.userSub,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get companyId => $composableBuilder(
    column: $table.companyId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get siteId => $composableBuilder(
    column: $table.siteId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get type => $composableBuilder(
    column: $table.type,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get targetUuid => $composableBuilder(
    column: $table.targetUuid,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get payloadJson => $composableBuilder(
    column: $table.payloadJson,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get baseRev => $composableBuilder(
    column: $table.baseRev,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get dependsOnJson => $composableBuilder(
    column: $table.dependsOnJson,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get deviceTime => $composableBuilder(
    column: $table.deviceTime,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get elapsedMs => $composableBuilder(
    column: $table.elapsedMs,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get bootId => $composableBuilder(
    column: $table.bootId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<bool> get offline => $composableBuilder(
    column: $table.offline,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get status => $composableBuilder(
    column: $table.status,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get attempts => $composableBuilder(
    column: $table.attempts,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<DateTime> get nextAttemptAt => $composableBuilder(
    column: $table.nextAttemptAt,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get lastErrorCode => $composableBuilder(
    column: $table.lastErrorCode,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get lastErrorMessage => $composableBuilder(
    column: $table.lastErrorMessage,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<DateTime> get createdAt => $composableBuilder(
    column: $table.createdAt,
    builder: (column) => ColumnFilters(column),
  );
}

class $$OutboxTableOrderingComposer
    extends Composer<_$AppDatabase, $OutboxTable> {
  $$OutboxTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get opUuid => $composableBuilder(
    column: $table.opUuid,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get userSub => $composableBuilder(
    column: $table.userSub,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get companyId => $composableBuilder(
    column: $table.companyId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get siteId => $composableBuilder(
    column: $table.siteId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get type => $composableBuilder(
    column: $table.type,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get targetUuid => $composableBuilder(
    column: $table.targetUuid,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get payloadJson => $composableBuilder(
    column: $table.payloadJson,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get baseRev => $composableBuilder(
    column: $table.baseRev,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get dependsOnJson => $composableBuilder(
    column: $table.dependsOnJson,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get deviceTime => $composableBuilder(
    column: $table.deviceTime,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get elapsedMs => $composableBuilder(
    column: $table.elapsedMs,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get bootId => $composableBuilder(
    column: $table.bootId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<bool> get offline => $composableBuilder(
    column: $table.offline,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get status => $composableBuilder(
    column: $table.status,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get attempts => $composableBuilder(
    column: $table.attempts,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<DateTime> get nextAttemptAt => $composableBuilder(
    column: $table.nextAttemptAt,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get lastErrorCode => $composableBuilder(
    column: $table.lastErrorCode,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get lastErrorMessage => $composableBuilder(
    column: $table.lastErrorMessage,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<DateTime> get createdAt => $composableBuilder(
    column: $table.createdAt,
    builder: (column) => ColumnOrderings(column),
  );
}

class $$OutboxTableAnnotationComposer
    extends Composer<_$AppDatabase, $OutboxTable> {
  $$OutboxTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get opUuid =>
      $composableBuilder(column: $table.opUuid, builder: (column) => column);

  GeneratedColumn<String> get userSub =>
      $composableBuilder(column: $table.userSub, builder: (column) => column);

  GeneratedColumn<int> get companyId =>
      $composableBuilder(column: $table.companyId, builder: (column) => column);

  GeneratedColumn<int> get siteId =>
      $composableBuilder(column: $table.siteId, builder: (column) => column);

  GeneratedColumn<String> get type =>
      $composableBuilder(column: $table.type, builder: (column) => column);

  GeneratedColumn<String> get targetUuid => $composableBuilder(
    column: $table.targetUuid,
    builder: (column) => column,
  );

  GeneratedColumn<String> get payloadJson => $composableBuilder(
    column: $table.payloadJson,
    builder: (column) => column,
  );

  GeneratedColumn<int> get baseRev =>
      $composableBuilder(column: $table.baseRev, builder: (column) => column);

  GeneratedColumn<String> get dependsOnJson => $composableBuilder(
    column: $table.dependsOnJson,
    builder: (column) => column,
  );

  GeneratedColumn<String> get deviceTime => $composableBuilder(
    column: $table.deviceTime,
    builder: (column) => column,
  );

  GeneratedColumn<int> get elapsedMs =>
      $composableBuilder(column: $table.elapsedMs, builder: (column) => column);

  GeneratedColumn<String> get bootId =>
      $composableBuilder(column: $table.bootId, builder: (column) => column);

  GeneratedColumn<bool> get offline =>
      $composableBuilder(column: $table.offline, builder: (column) => column);

  GeneratedColumn<String> get status =>
      $composableBuilder(column: $table.status, builder: (column) => column);

  GeneratedColumn<int> get attempts =>
      $composableBuilder(column: $table.attempts, builder: (column) => column);

  GeneratedColumn<DateTime> get nextAttemptAt => $composableBuilder(
    column: $table.nextAttemptAt,
    builder: (column) => column,
  );

  GeneratedColumn<String> get lastErrorCode => $composableBuilder(
    column: $table.lastErrorCode,
    builder: (column) => column,
  );

  GeneratedColumn<String> get lastErrorMessage => $composableBuilder(
    column: $table.lastErrorMessage,
    builder: (column) => column,
  );

  GeneratedColumn<DateTime> get createdAt =>
      $composableBuilder(column: $table.createdAt, builder: (column) => column);
}

class $$OutboxTableTableManager
    extends
        RootTableManager<
          _$AppDatabase,
          $OutboxTable,
          OutboxData,
          $$OutboxTableFilterComposer,
          $$OutboxTableOrderingComposer,
          $$OutboxTableAnnotationComposer,
          $$OutboxTableCreateCompanionBuilder,
          $$OutboxTableUpdateCompanionBuilder,
          (OutboxData, BaseReferences<_$AppDatabase, $OutboxTable, OutboxData>),
          OutboxData,
          PrefetchHooks Function()
        > {
  $$OutboxTableTableManager(_$AppDatabase db, $OutboxTable table)
    : super(
        TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$OutboxTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$OutboxTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$OutboxTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback:
              ({
                Value<String> opUuid = const Value.absent(),
                Value<String> userSub = const Value.absent(),
                Value<int?> companyId = const Value.absent(),
                Value<int?> siteId = const Value.absent(),
                Value<String> type = const Value.absent(),
                Value<String> targetUuid = const Value.absent(),
                Value<String> payloadJson = const Value.absent(),
                Value<int?> baseRev = const Value.absent(),
                Value<String> dependsOnJson = const Value.absent(),
                Value<String> deviceTime = const Value.absent(),
                Value<int> elapsedMs = const Value.absent(),
                Value<String> bootId = const Value.absent(),
                Value<bool> offline = const Value.absent(),
                Value<String> status = const Value.absent(),
                Value<int> attempts = const Value.absent(),
                Value<DateTime?> nextAttemptAt = const Value.absent(),
                Value<String?> lastErrorCode = const Value.absent(),
                Value<String?> lastErrorMessage = const Value.absent(),
                Value<DateTime> createdAt = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => OutboxCompanion(
                opUuid: opUuid,
                userSub: userSub,
                companyId: companyId,
                siteId: siteId,
                type: type,
                targetUuid: targetUuid,
                payloadJson: payloadJson,
                baseRev: baseRev,
                dependsOnJson: dependsOnJson,
                deviceTime: deviceTime,
                elapsedMs: elapsedMs,
                bootId: bootId,
                offline: offline,
                status: status,
                attempts: attempts,
                nextAttemptAt: nextAttemptAt,
                lastErrorCode: lastErrorCode,
                lastErrorMessage: lastErrorMessage,
                createdAt: createdAt,
                rowid: rowid,
              ),
          createCompanionCallback:
              ({
                required String opUuid,
                required String userSub,
                Value<int?> companyId = const Value.absent(),
                Value<int?> siteId = const Value.absent(),
                required String type,
                required String targetUuid,
                required String payloadJson,
                Value<int?> baseRev = const Value.absent(),
                Value<String> dependsOnJson = const Value.absent(),
                required String deviceTime,
                required int elapsedMs,
                required String bootId,
                Value<bool> offline = const Value.absent(),
                Value<String> status = const Value.absent(),
                Value<int> attempts = const Value.absent(),
                Value<DateTime?> nextAttemptAt = const Value.absent(),
                Value<String?> lastErrorCode = const Value.absent(),
                Value<String?> lastErrorMessage = const Value.absent(),
                required DateTime createdAt,
                Value<int> rowid = const Value.absent(),
              }) => OutboxCompanion.insert(
                opUuid: opUuid,
                userSub: userSub,
                companyId: companyId,
                siteId: siteId,
                type: type,
                targetUuid: targetUuid,
                payloadJson: payloadJson,
                baseRev: baseRev,
                dependsOnJson: dependsOnJson,
                deviceTime: deviceTime,
                elapsedMs: elapsedMs,
                bootId: bootId,
                offline: offline,
                status: status,
                attempts: attempts,
                nextAttemptAt: nextAttemptAt,
                lastErrorCode: lastErrorCode,
                lastErrorMessage: lastErrorMessage,
                createdAt: createdAt,
                rowid: rowid,
              ),
          withReferenceMapper: (p0) => p0
              .map(
                (e) => (
                  e.readTable<$OutboxTable, OutboxData>(table),
                  BaseReferences<_$AppDatabase, $OutboxTable, OutboxData>(
                    db,
                    table,
                    e,
                  ),
                ),
              )
              .toList(),
          prefetchHooksCallback: null,
        ),
      );
}

typedef $$OutboxTableProcessedTableManager =
    ProcessedTableManager<
      _$AppDatabase,
      $OutboxTable,
      OutboxData,
      $$OutboxTableFilterComposer,
      $$OutboxTableOrderingComposer,
      $$OutboxTableAnnotationComposer,
      $$OutboxTableCreateCompanionBuilder,
      $$OutboxTableUpdateCompanionBuilder,
      (OutboxData, BaseReferences<_$AppDatabase, $OutboxTable, OutboxData>),
      OutboxData,
      PrefetchHooks Function()
    >;
typedef $$KvEntriesTableCreateCompanionBuilder = KvEntriesCompanion Function({
  required String key,
  required String value,
  Value<int> rowid,
});
typedef $$KvEntriesTableUpdateCompanionBuilder = KvEntriesCompanion Function({
  Value<String> key,
  Value<String> value,
  Value<int> rowid,
});

class $$KvEntriesTableFilterComposer
    extends Composer<_$AppDatabase, $KvEntriesTable> {
  $$KvEntriesTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get key => $composableBuilder(
    column: $table.key,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get value => $composableBuilder(
    column: $table.value,
    builder: (column) => ColumnFilters(column),
  );
}

class $$KvEntriesTableOrderingComposer
    extends Composer<_$AppDatabase, $KvEntriesTable> {
  $$KvEntriesTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get key => $composableBuilder(
    column: $table.key,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get value => $composableBuilder(
    column: $table.value,
    builder: (column) => ColumnOrderings(column),
  );
}

class $$KvEntriesTableAnnotationComposer
    extends Composer<_$AppDatabase, $KvEntriesTable> {
  $$KvEntriesTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get key =>
      $composableBuilder(column: $table.key, builder: (column) => column);

  GeneratedColumn<String> get value =>
      $composableBuilder(column: $table.value, builder: (column) => column);
}

class $$KvEntriesTableTableManager
    extends
        RootTableManager<
          _$AppDatabase,
          $KvEntriesTable,
          KvEntry,
          $$KvEntriesTableFilterComposer,
          $$KvEntriesTableOrderingComposer,
          $$KvEntriesTableAnnotationComposer,
          $$KvEntriesTableCreateCompanionBuilder,
          $$KvEntriesTableUpdateCompanionBuilder,
          (KvEntry, BaseReferences<_$AppDatabase, $KvEntriesTable, KvEntry>),
          KvEntry,
          PrefetchHooks Function()
        > {
  $$KvEntriesTableTableManager(_$AppDatabase db, $KvEntriesTable table)
    : super(
        TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$KvEntriesTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$KvEntriesTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$KvEntriesTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback: ({
            Value<String> key = const Value.absent(),
            Value<String> value = const Value.absent(),
            Value<int> rowid = const Value.absent(),
          }) => KvEntriesCompanion(key: key, value: value, rowid: rowid),
          createCompanionCallback: ({
            required String key,
            required String value,
            Value<int> rowid = const Value.absent(),
          }) => KvEntriesCompanion.insert(key: key, value: value, rowid: rowid),
          withReferenceMapper: (p0) => p0
              .map(
                (e) => (
                  e.readTable<$KvEntriesTable, KvEntry>(table),
                  BaseReferences<_$AppDatabase, $KvEntriesTable, KvEntry>(
                    db,
                    table,
                    e,
                  ),
                ),
              )
              .toList(),
          prefetchHooksCallback: null,
        ),
      );
}

typedef $$KvEntriesTableProcessedTableManager =
    ProcessedTableManager<
      _$AppDatabase,
      $KvEntriesTable,
      KvEntry,
      $$KvEntriesTableFilterComposer,
      $$KvEntriesTableOrderingComposer,
      $$KvEntriesTableAnnotationComposer,
      $$KvEntriesTableCreateCompanionBuilder,
      $$KvEntriesTableUpdateCompanionBuilder,
      (KvEntry, BaseReferences<_$AppDatabase, $KvEntriesTable, KvEntry>),
      KvEntry,
      PrefetchHooks Function()
    >;
typedef $$LocalProgressReportsTableCreateCompanionBuilder =
    LocalProgressReportsCompanion Function({
      required String clientUuid,
      required String userSub,
      Value<int?> companyId,
      required int projectId,
      Value<String> projectLabel,
      required int stageId,
      Value<String> stageLabel,
      Value<double?> pctBefore,
      required double pctAfter,
      Value<String> work,
      Value<String?> issues,
      Value<String> photoUuidsJson,
      Value<int> serverPhotoCount,
      Value<String?> reason,
      Value<int?> serverId,
      Value<int?> serverRev,
      Value<String?> docNo,
      Value<String?> editableUntil,
      Value<double?> serverPctAfter,
      Value<String> syncState,
      Value<String?> lastError,
      Value<String?> lastErrorCode,
      Value<String?> conflictCopyJson,
      Value<bool> offline,
      required DateTime createdAt,
      required DateTime updatedAt,
      Value<int> rowid,
    });
typedef $$LocalProgressReportsTableUpdateCompanionBuilder =
    LocalProgressReportsCompanion Function({
      Value<String> clientUuid,
      Value<String> userSub,
      Value<int?> companyId,
      Value<int> projectId,
      Value<String> projectLabel,
      Value<int> stageId,
      Value<String> stageLabel,
      Value<double?> pctBefore,
      Value<double> pctAfter,
      Value<String> work,
      Value<String?> issues,
      Value<String> photoUuidsJson,
      Value<int> serverPhotoCount,
      Value<String?> reason,
      Value<int?> serverId,
      Value<int?> serverRev,
      Value<String?> docNo,
      Value<String?> editableUntil,
      Value<double?> serverPctAfter,
      Value<String> syncState,
      Value<String?> lastError,
      Value<String?> lastErrorCode,
      Value<String?> conflictCopyJson,
      Value<bool> offline,
      Value<DateTime> createdAt,
      Value<DateTime> updatedAt,
      Value<int> rowid,
    });

class $$LocalProgressReportsTableFilterComposer
    extends Composer<_$AppDatabase, $LocalProgressReportsTable> {
  $$LocalProgressReportsTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get clientUuid => $composableBuilder(
    column: $table.clientUuid,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get userSub => $composableBuilder(
    column: $table.userSub,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get companyId => $composableBuilder(
    column: $table.companyId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get projectId => $composableBuilder(
    column: $table.projectId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get projectLabel => $composableBuilder(
    column: $table.projectLabel,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get stageId => $composableBuilder(
    column: $table.stageId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get stageLabel => $composableBuilder(
    column: $table.stageLabel,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<double> get pctBefore => $composableBuilder(
    column: $table.pctBefore,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<double> get pctAfter => $composableBuilder(
    column: $table.pctAfter,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get work => $composableBuilder(
    column: $table.work,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get issues => $composableBuilder(
    column: $table.issues,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get photoUuidsJson => $composableBuilder(
    column: $table.photoUuidsJson,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get serverPhotoCount => $composableBuilder(
    column: $table.serverPhotoCount,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get reason => $composableBuilder(
    column: $table.reason,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get serverId => $composableBuilder(
    column: $table.serverId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get serverRev => $composableBuilder(
    column: $table.serverRev,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get docNo => $composableBuilder(
    column: $table.docNo,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get editableUntil => $composableBuilder(
    column: $table.editableUntil,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<double> get serverPctAfter => $composableBuilder(
    column: $table.serverPctAfter,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get syncState => $composableBuilder(
    column: $table.syncState,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get lastError => $composableBuilder(
    column: $table.lastError,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get lastErrorCode => $composableBuilder(
    column: $table.lastErrorCode,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get conflictCopyJson => $composableBuilder(
    column: $table.conflictCopyJson,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<bool> get offline => $composableBuilder(
    column: $table.offline,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<DateTime> get createdAt => $composableBuilder(
    column: $table.createdAt,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<DateTime> get updatedAt => $composableBuilder(
    column: $table.updatedAt,
    builder: (column) => ColumnFilters(column),
  );
}

class $$LocalProgressReportsTableOrderingComposer
    extends Composer<_$AppDatabase, $LocalProgressReportsTable> {
  $$LocalProgressReportsTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get clientUuid => $composableBuilder(
    column: $table.clientUuid,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get userSub => $composableBuilder(
    column: $table.userSub,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get companyId => $composableBuilder(
    column: $table.companyId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get projectId => $composableBuilder(
    column: $table.projectId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get projectLabel => $composableBuilder(
    column: $table.projectLabel,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get stageId => $composableBuilder(
    column: $table.stageId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get stageLabel => $composableBuilder(
    column: $table.stageLabel,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<double> get pctBefore => $composableBuilder(
    column: $table.pctBefore,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<double> get pctAfter => $composableBuilder(
    column: $table.pctAfter,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get work => $composableBuilder(
    column: $table.work,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get issues => $composableBuilder(
    column: $table.issues,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get photoUuidsJson => $composableBuilder(
    column: $table.photoUuidsJson,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get serverPhotoCount => $composableBuilder(
    column: $table.serverPhotoCount,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get reason => $composableBuilder(
    column: $table.reason,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get serverId => $composableBuilder(
    column: $table.serverId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get serverRev => $composableBuilder(
    column: $table.serverRev,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get docNo => $composableBuilder(
    column: $table.docNo,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get editableUntil => $composableBuilder(
    column: $table.editableUntil,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<double> get serverPctAfter => $composableBuilder(
    column: $table.serverPctAfter,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get syncState => $composableBuilder(
    column: $table.syncState,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get lastError => $composableBuilder(
    column: $table.lastError,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get lastErrorCode => $composableBuilder(
    column: $table.lastErrorCode,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get conflictCopyJson => $composableBuilder(
    column: $table.conflictCopyJson,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<bool> get offline => $composableBuilder(
    column: $table.offline,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<DateTime> get createdAt => $composableBuilder(
    column: $table.createdAt,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<DateTime> get updatedAt => $composableBuilder(
    column: $table.updatedAt,
    builder: (column) => ColumnOrderings(column),
  );
}

class $$LocalProgressReportsTableAnnotationComposer
    extends Composer<_$AppDatabase, $LocalProgressReportsTable> {
  $$LocalProgressReportsTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get clientUuid => $composableBuilder(
    column: $table.clientUuid,
    builder: (column) => column,
  );

  GeneratedColumn<String> get userSub =>
      $composableBuilder(column: $table.userSub, builder: (column) => column);

  GeneratedColumn<int> get companyId =>
      $composableBuilder(column: $table.companyId, builder: (column) => column);

  GeneratedColumn<int> get projectId =>
      $composableBuilder(column: $table.projectId, builder: (column) => column);

  GeneratedColumn<String> get projectLabel => $composableBuilder(
    column: $table.projectLabel,
    builder: (column) => column,
  );

  GeneratedColumn<int> get stageId =>
      $composableBuilder(column: $table.stageId, builder: (column) => column);

  GeneratedColumn<String> get stageLabel => $composableBuilder(
    column: $table.stageLabel,
    builder: (column) => column,
  );

  GeneratedColumn<double> get pctBefore =>
      $composableBuilder(column: $table.pctBefore, builder: (column) => column);

  GeneratedColumn<double> get pctAfter =>
      $composableBuilder(column: $table.pctAfter, builder: (column) => column);

  GeneratedColumn<String> get work =>
      $composableBuilder(column: $table.work, builder: (column) => column);

  GeneratedColumn<String> get issues =>
      $composableBuilder(column: $table.issues, builder: (column) => column);

  GeneratedColumn<String> get photoUuidsJson => $composableBuilder(
    column: $table.photoUuidsJson,
    builder: (column) => column,
  );

  GeneratedColumn<int> get serverPhotoCount => $composableBuilder(
    column: $table.serverPhotoCount,
    builder: (column) => column,
  );

  GeneratedColumn<String> get reason =>
      $composableBuilder(column: $table.reason, builder: (column) => column);

  GeneratedColumn<int> get serverId =>
      $composableBuilder(column: $table.serverId, builder: (column) => column);

  GeneratedColumn<int> get serverRev =>
      $composableBuilder(column: $table.serverRev, builder: (column) => column);

  GeneratedColumn<String> get docNo =>
      $composableBuilder(column: $table.docNo, builder: (column) => column);

  GeneratedColumn<String> get editableUntil => $composableBuilder(
    column: $table.editableUntil,
    builder: (column) => column,
  );

  GeneratedColumn<double> get serverPctAfter => $composableBuilder(
    column: $table.serverPctAfter,
    builder: (column) => column,
  );

  GeneratedColumn<String> get syncState =>
      $composableBuilder(column: $table.syncState, builder: (column) => column);

  GeneratedColumn<String> get lastError =>
      $composableBuilder(column: $table.lastError, builder: (column) => column);

  GeneratedColumn<String> get lastErrorCode => $composableBuilder(
    column: $table.lastErrorCode,
    builder: (column) => column,
  );

  GeneratedColumn<String> get conflictCopyJson => $composableBuilder(
    column: $table.conflictCopyJson,
    builder: (column) => column,
  );

  GeneratedColumn<bool> get offline =>
      $composableBuilder(column: $table.offline, builder: (column) => column);

  GeneratedColumn<DateTime> get createdAt =>
      $composableBuilder(column: $table.createdAt, builder: (column) => column);

  GeneratedColumn<DateTime> get updatedAt =>
      $composableBuilder(column: $table.updatedAt, builder: (column) => column);
}

class $$LocalProgressReportsTableTableManager
    extends
        RootTableManager<
          _$AppDatabase,
          $LocalProgressReportsTable,
          LocalProgressReport,
          $$LocalProgressReportsTableFilterComposer,
          $$LocalProgressReportsTableOrderingComposer,
          $$LocalProgressReportsTableAnnotationComposer,
          $$LocalProgressReportsTableCreateCompanionBuilder,
          $$LocalProgressReportsTableUpdateCompanionBuilder,
          (
            LocalProgressReport,
            BaseReferences<
              _$AppDatabase,
              $LocalProgressReportsTable,
              LocalProgressReport
            >,
          ),
          LocalProgressReport,
          PrefetchHooks Function()
        > {
  $$LocalProgressReportsTableTableManager(
    _$AppDatabase db,
    $LocalProgressReportsTable table,
  ) : super(
        TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$LocalProgressReportsTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$LocalProgressReportsTableOrderingComposer(
                $db: db,
                $table: table,
              ),
          createComputedFieldComposer: () =>
              $$LocalProgressReportsTableAnnotationComposer(
                $db: db,
                $table: table,
              ),
          updateCompanionCallback:
              ({
                Value<String> clientUuid = const Value.absent(),
                Value<String> userSub = const Value.absent(),
                Value<int?> companyId = const Value.absent(),
                Value<int> projectId = const Value.absent(),
                Value<String> projectLabel = const Value.absent(),
                Value<int> stageId = const Value.absent(),
                Value<String> stageLabel = const Value.absent(),
                Value<double?> pctBefore = const Value.absent(),
                Value<double> pctAfter = const Value.absent(),
                Value<String> work = const Value.absent(),
                Value<String?> issues = const Value.absent(),
                Value<String> photoUuidsJson = const Value.absent(),
                Value<int> serverPhotoCount = const Value.absent(),
                Value<String?> reason = const Value.absent(),
                Value<int?> serverId = const Value.absent(),
                Value<int?> serverRev = const Value.absent(),
                Value<String?> docNo = const Value.absent(),
                Value<String?> editableUntil = const Value.absent(),
                Value<double?> serverPctAfter = const Value.absent(),
                Value<String> syncState = const Value.absent(),
                Value<String?> lastError = const Value.absent(),
                Value<String?> lastErrorCode = const Value.absent(),
                Value<String?> conflictCopyJson = const Value.absent(),
                Value<bool> offline = const Value.absent(),
                Value<DateTime> createdAt = const Value.absent(),
                Value<DateTime> updatedAt = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => LocalProgressReportsCompanion(
                clientUuid: clientUuid,
                userSub: userSub,
                companyId: companyId,
                projectId: projectId,
                projectLabel: projectLabel,
                stageId: stageId,
                stageLabel: stageLabel,
                pctBefore: pctBefore,
                pctAfter: pctAfter,
                work: work,
                issues: issues,
                photoUuidsJson: photoUuidsJson,
                serverPhotoCount: serverPhotoCount,
                reason: reason,
                serverId: serverId,
                serverRev: serverRev,
                docNo: docNo,
                editableUntil: editableUntil,
                serverPctAfter: serverPctAfter,
                syncState: syncState,
                lastError: lastError,
                lastErrorCode: lastErrorCode,
                conflictCopyJson: conflictCopyJson,
                offline: offline,
                createdAt: createdAt,
                updatedAt: updatedAt,
                rowid: rowid,
              ),
          createCompanionCallback:
              ({
                required String clientUuid,
                required String userSub,
                Value<int?> companyId = const Value.absent(),
                required int projectId,
                Value<String> projectLabel = const Value.absent(),
                required int stageId,
                Value<String> stageLabel = const Value.absent(),
                Value<double?> pctBefore = const Value.absent(),
                required double pctAfter,
                Value<String> work = const Value.absent(),
                Value<String?> issues = const Value.absent(),
                Value<String> photoUuidsJson = const Value.absent(),
                Value<int> serverPhotoCount = const Value.absent(),
                Value<String?> reason = const Value.absent(),
                Value<int?> serverId = const Value.absent(),
                Value<int?> serverRev = const Value.absent(),
                Value<String?> docNo = const Value.absent(),
                Value<String?> editableUntil = const Value.absent(),
                Value<double?> serverPctAfter = const Value.absent(),
                Value<String> syncState = const Value.absent(),
                Value<String?> lastError = const Value.absent(),
                Value<String?> lastErrorCode = const Value.absent(),
                Value<String?> conflictCopyJson = const Value.absent(),
                Value<bool> offline = const Value.absent(),
                required DateTime createdAt,
                required DateTime updatedAt,
                Value<int> rowid = const Value.absent(),
              }) => LocalProgressReportsCompanion.insert(
                clientUuid: clientUuid,
                userSub: userSub,
                companyId: companyId,
                projectId: projectId,
                projectLabel: projectLabel,
                stageId: stageId,
                stageLabel: stageLabel,
                pctBefore: pctBefore,
                pctAfter: pctAfter,
                work: work,
                issues: issues,
                photoUuidsJson: photoUuidsJson,
                serverPhotoCount: serverPhotoCount,
                reason: reason,
                serverId: serverId,
                serverRev: serverRev,
                docNo: docNo,
                editableUntil: editableUntil,
                serverPctAfter: serverPctAfter,
                syncState: syncState,
                lastError: lastError,
                lastErrorCode: lastErrorCode,
                conflictCopyJson: conflictCopyJson,
                offline: offline,
                createdAt: createdAt,
                updatedAt: updatedAt,
                rowid: rowid,
              ),
          withReferenceMapper: (p0) => p0
              .map(
                (e) => (
                  e.readTable<$LocalProgressReportsTable, LocalProgressReport>(
                    table,
                  ),
                  BaseReferences<
                    _$AppDatabase,
                    $LocalProgressReportsTable,
                    LocalProgressReport
                  >(db, table, e),
                ),
              )
              .toList(),
          prefetchHooksCallback: null,
        ),
      );
}

typedef $$LocalProgressReportsTableProcessedTableManager =
    ProcessedTableManager<
      _$AppDatabase,
      $LocalProgressReportsTable,
      LocalProgressReport,
      $$LocalProgressReportsTableFilterComposer,
      $$LocalProgressReportsTableOrderingComposer,
      $$LocalProgressReportsTableAnnotationComposer,
      $$LocalProgressReportsTableCreateCompanionBuilder,
      $$LocalProgressReportsTableUpdateCompanionBuilder,
      (
        LocalProgressReport,
        BaseReferences<
          _$AppDatabase,
          $LocalProgressReportsTable,
          LocalProgressReport
        >,
      ),
      LocalProgressReport,
      PrefetchHooks Function()
    >;
typedef $$LocalFieldReportsTableCreateCompanionBuilder =
    LocalFieldReportsCompanion Function({
      required String clientUuid,
      required String userSub,
      Value<int?> companyId,
      required String reportType,
      required int projectId,
      Value<String> projectLabel,
      Value<int?> unitId,
      Value<int?> clientId,
      required String reportDate,
      Value<double?> hourMeter,
      Value<String> contentJson,
      Value<String> photoUuidsJson,
      Value<int> serverPhotoCount,
      Value<String?> reason,
      Value<int?> serverId,
      Value<int?> serverRev,
      Value<String?> docNo,
      Value<String?> editableUntil,
      Value<String> syncState,
      Value<String?> lastError,
      Value<String?> lastErrorCode,
      Value<String?> conflictCopyJson,
      Value<bool> offline,
      required DateTime createdAt,
      required DateTime updatedAt,
      Value<int> rowid,
    });
typedef $$LocalFieldReportsTableUpdateCompanionBuilder =
    LocalFieldReportsCompanion Function({
      Value<String> clientUuid,
      Value<String> userSub,
      Value<int?> companyId,
      Value<String> reportType,
      Value<int> projectId,
      Value<String> projectLabel,
      Value<int?> unitId,
      Value<int?> clientId,
      Value<String> reportDate,
      Value<double?> hourMeter,
      Value<String> contentJson,
      Value<String> photoUuidsJson,
      Value<int> serverPhotoCount,
      Value<String?> reason,
      Value<int?> serverId,
      Value<int?> serverRev,
      Value<String?> docNo,
      Value<String?> editableUntil,
      Value<String> syncState,
      Value<String?> lastError,
      Value<String?> lastErrorCode,
      Value<String?> conflictCopyJson,
      Value<bool> offline,
      Value<DateTime> createdAt,
      Value<DateTime> updatedAt,
      Value<int> rowid,
    });

class $$LocalFieldReportsTableFilterComposer
    extends Composer<_$AppDatabase, $LocalFieldReportsTable> {
  $$LocalFieldReportsTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get clientUuid => $composableBuilder(
    column: $table.clientUuid,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get userSub => $composableBuilder(
    column: $table.userSub,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get companyId => $composableBuilder(
    column: $table.companyId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get reportType => $composableBuilder(
    column: $table.reportType,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get projectId => $composableBuilder(
    column: $table.projectId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get projectLabel => $composableBuilder(
    column: $table.projectLabel,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get unitId => $composableBuilder(
    column: $table.unitId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get clientId => $composableBuilder(
    column: $table.clientId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get reportDate => $composableBuilder(
    column: $table.reportDate,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<double> get hourMeter => $composableBuilder(
    column: $table.hourMeter,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get contentJson => $composableBuilder(
    column: $table.contentJson,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get photoUuidsJson => $composableBuilder(
    column: $table.photoUuidsJson,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get serverPhotoCount => $composableBuilder(
    column: $table.serverPhotoCount,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get reason => $composableBuilder(
    column: $table.reason,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get serverId => $composableBuilder(
    column: $table.serverId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get serverRev => $composableBuilder(
    column: $table.serverRev,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get docNo => $composableBuilder(
    column: $table.docNo,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get editableUntil => $composableBuilder(
    column: $table.editableUntil,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get syncState => $composableBuilder(
    column: $table.syncState,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get lastError => $composableBuilder(
    column: $table.lastError,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get lastErrorCode => $composableBuilder(
    column: $table.lastErrorCode,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get conflictCopyJson => $composableBuilder(
    column: $table.conflictCopyJson,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<bool> get offline => $composableBuilder(
    column: $table.offline,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<DateTime> get createdAt => $composableBuilder(
    column: $table.createdAt,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<DateTime> get updatedAt => $composableBuilder(
    column: $table.updatedAt,
    builder: (column) => ColumnFilters(column),
  );
}

class $$LocalFieldReportsTableOrderingComposer
    extends Composer<_$AppDatabase, $LocalFieldReportsTable> {
  $$LocalFieldReportsTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get clientUuid => $composableBuilder(
    column: $table.clientUuid,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get userSub => $composableBuilder(
    column: $table.userSub,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get companyId => $composableBuilder(
    column: $table.companyId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get reportType => $composableBuilder(
    column: $table.reportType,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get projectId => $composableBuilder(
    column: $table.projectId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get projectLabel => $composableBuilder(
    column: $table.projectLabel,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get unitId => $composableBuilder(
    column: $table.unitId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get clientId => $composableBuilder(
    column: $table.clientId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get reportDate => $composableBuilder(
    column: $table.reportDate,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<double> get hourMeter => $composableBuilder(
    column: $table.hourMeter,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get contentJson => $composableBuilder(
    column: $table.contentJson,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get photoUuidsJson => $composableBuilder(
    column: $table.photoUuidsJson,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get serverPhotoCount => $composableBuilder(
    column: $table.serverPhotoCount,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get reason => $composableBuilder(
    column: $table.reason,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get serverId => $composableBuilder(
    column: $table.serverId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get serverRev => $composableBuilder(
    column: $table.serverRev,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get docNo => $composableBuilder(
    column: $table.docNo,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get editableUntil => $composableBuilder(
    column: $table.editableUntil,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get syncState => $composableBuilder(
    column: $table.syncState,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get lastError => $composableBuilder(
    column: $table.lastError,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get lastErrorCode => $composableBuilder(
    column: $table.lastErrorCode,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get conflictCopyJson => $composableBuilder(
    column: $table.conflictCopyJson,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<bool> get offline => $composableBuilder(
    column: $table.offline,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<DateTime> get createdAt => $composableBuilder(
    column: $table.createdAt,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<DateTime> get updatedAt => $composableBuilder(
    column: $table.updatedAt,
    builder: (column) => ColumnOrderings(column),
  );
}

class $$LocalFieldReportsTableAnnotationComposer
    extends Composer<_$AppDatabase, $LocalFieldReportsTable> {
  $$LocalFieldReportsTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get clientUuid => $composableBuilder(
    column: $table.clientUuid,
    builder: (column) => column,
  );

  GeneratedColumn<String> get userSub =>
      $composableBuilder(column: $table.userSub, builder: (column) => column);

  GeneratedColumn<int> get companyId =>
      $composableBuilder(column: $table.companyId, builder: (column) => column);

  GeneratedColumn<String> get reportType => $composableBuilder(
    column: $table.reportType,
    builder: (column) => column,
  );

  GeneratedColumn<int> get projectId =>
      $composableBuilder(column: $table.projectId, builder: (column) => column);

  GeneratedColumn<String> get projectLabel => $composableBuilder(
    column: $table.projectLabel,
    builder: (column) => column,
  );

  GeneratedColumn<int> get unitId =>
      $composableBuilder(column: $table.unitId, builder: (column) => column);

  GeneratedColumn<int> get clientId =>
      $composableBuilder(column: $table.clientId, builder: (column) => column);

  GeneratedColumn<String> get reportDate => $composableBuilder(
    column: $table.reportDate,
    builder: (column) => column,
  );

  GeneratedColumn<double> get hourMeter =>
      $composableBuilder(column: $table.hourMeter, builder: (column) => column);

  GeneratedColumn<String> get contentJson => $composableBuilder(
    column: $table.contentJson,
    builder: (column) => column,
  );

  GeneratedColumn<String> get photoUuidsJson => $composableBuilder(
    column: $table.photoUuidsJson,
    builder: (column) => column,
  );

  GeneratedColumn<int> get serverPhotoCount => $composableBuilder(
    column: $table.serverPhotoCount,
    builder: (column) => column,
  );

  GeneratedColumn<String> get reason =>
      $composableBuilder(column: $table.reason, builder: (column) => column);

  GeneratedColumn<int> get serverId =>
      $composableBuilder(column: $table.serverId, builder: (column) => column);

  GeneratedColumn<int> get serverRev =>
      $composableBuilder(column: $table.serverRev, builder: (column) => column);

  GeneratedColumn<String> get docNo =>
      $composableBuilder(column: $table.docNo, builder: (column) => column);

  GeneratedColumn<String> get editableUntil => $composableBuilder(
    column: $table.editableUntil,
    builder: (column) => column,
  );

  GeneratedColumn<String> get syncState =>
      $composableBuilder(column: $table.syncState, builder: (column) => column);

  GeneratedColumn<String> get lastError =>
      $composableBuilder(column: $table.lastError, builder: (column) => column);

  GeneratedColumn<String> get lastErrorCode => $composableBuilder(
    column: $table.lastErrorCode,
    builder: (column) => column,
  );

  GeneratedColumn<String> get conflictCopyJson => $composableBuilder(
    column: $table.conflictCopyJson,
    builder: (column) => column,
  );

  GeneratedColumn<bool> get offline =>
      $composableBuilder(column: $table.offline, builder: (column) => column);

  GeneratedColumn<DateTime> get createdAt =>
      $composableBuilder(column: $table.createdAt, builder: (column) => column);

  GeneratedColumn<DateTime> get updatedAt =>
      $composableBuilder(column: $table.updatedAt, builder: (column) => column);
}

class $$LocalFieldReportsTableTableManager
    extends
        RootTableManager<
          _$AppDatabase,
          $LocalFieldReportsTable,
          LocalFieldReport,
          $$LocalFieldReportsTableFilterComposer,
          $$LocalFieldReportsTableOrderingComposer,
          $$LocalFieldReportsTableAnnotationComposer,
          $$LocalFieldReportsTableCreateCompanionBuilder,
          $$LocalFieldReportsTableUpdateCompanionBuilder,
          (
            LocalFieldReport,
            BaseReferences<
              _$AppDatabase,
              $LocalFieldReportsTable,
              LocalFieldReport
            >,
          ),
          LocalFieldReport,
          PrefetchHooks Function()
        > {
  $$LocalFieldReportsTableTableManager(
    _$AppDatabase db,
    $LocalFieldReportsTable table,
  ) : super(
        TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$LocalFieldReportsTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$LocalFieldReportsTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$LocalFieldReportsTableAnnotationComposer(
                $db: db,
                $table: table,
              ),
          updateCompanionCallback:
              ({
                Value<String> clientUuid = const Value.absent(),
                Value<String> userSub = const Value.absent(),
                Value<int?> companyId = const Value.absent(),
                Value<String> reportType = const Value.absent(),
                Value<int> projectId = const Value.absent(),
                Value<String> projectLabel = const Value.absent(),
                Value<int?> unitId = const Value.absent(),
                Value<int?> clientId = const Value.absent(),
                Value<String> reportDate = const Value.absent(),
                Value<double?> hourMeter = const Value.absent(),
                Value<String> contentJson = const Value.absent(),
                Value<String> photoUuidsJson = const Value.absent(),
                Value<int> serverPhotoCount = const Value.absent(),
                Value<String?> reason = const Value.absent(),
                Value<int?> serverId = const Value.absent(),
                Value<int?> serverRev = const Value.absent(),
                Value<String?> docNo = const Value.absent(),
                Value<String?> editableUntil = const Value.absent(),
                Value<String> syncState = const Value.absent(),
                Value<String?> lastError = const Value.absent(),
                Value<String?> lastErrorCode = const Value.absent(),
                Value<String?> conflictCopyJson = const Value.absent(),
                Value<bool> offline = const Value.absent(),
                Value<DateTime> createdAt = const Value.absent(),
                Value<DateTime> updatedAt = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => LocalFieldReportsCompanion(
                clientUuid: clientUuid,
                userSub: userSub,
                companyId: companyId,
                reportType: reportType,
                projectId: projectId,
                projectLabel: projectLabel,
                unitId: unitId,
                clientId: clientId,
                reportDate: reportDate,
                hourMeter: hourMeter,
                contentJson: contentJson,
                photoUuidsJson: photoUuidsJson,
                serverPhotoCount: serverPhotoCount,
                reason: reason,
                serverId: serverId,
                serverRev: serverRev,
                docNo: docNo,
                editableUntil: editableUntil,
                syncState: syncState,
                lastError: lastError,
                lastErrorCode: lastErrorCode,
                conflictCopyJson: conflictCopyJson,
                offline: offline,
                createdAt: createdAt,
                updatedAt: updatedAt,
                rowid: rowid,
              ),
          createCompanionCallback:
              ({
                required String clientUuid,
                required String userSub,
                Value<int?> companyId = const Value.absent(),
                required String reportType,
                required int projectId,
                Value<String> projectLabel = const Value.absent(),
                Value<int?> unitId = const Value.absent(),
                Value<int?> clientId = const Value.absent(),
                required String reportDate,
                Value<double?> hourMeter = const Value.absent(),
                Value<String> contentJson = const Value.absent(),
                Value<String> photoUuidsJson = const Value.absent(),
                Value<int> serverPhotoCount = const Value.absent(),
                Value<String?> reason = const Value.absent(),
                Value<int?> serverId = const Value.absent(),
                Value<int?> serverRev = const Value.absent(),
                Value<String?> docNo = const Value.absent(),
                Value<String?> editableUntil = const Value.absent(),
                Value<String> syncState = const Value.absent(),
                Value<String?> lastError = const Value.absent(),
                Value<String?> lastErrorCode = const Value.absent(),
                Value<String?> conflictCopyJson = const Value.absent(),
                Value<bool> offline = const Value.absent(),
                required DateTime createdAt,
                required DateTime updatedAt,
                Value<int> rowid = const Value.absent(),
              }) => LocalFieldReportsCompanion.insert(
                clientUuid: clientUuid,
                userSub: userSub,
                companyId: companyId,
                reportType: reportType,
                projectId: projectId,
                projectLabel: projectLabel,
                unitId: unitId,
                clientId: clientId,
                reportDate: reportDate,
                hourMeter: hourMeter,
                contentJson: contentJson,
                photoUuidsJson: photoUuidsJson,
                serverPhotoCount: serverPhotoCount,
                reason: reason,
                serverId: serverId,
                serverRev: serverRev,
                docNo: docNo,
                editableUntil: editableUntil,
                syncState: syncState,
                lastError: lastError,
                lastErrorCode: lastErrorCode,
                conflictCopyJson: conflictCopyJson,
                offline: offline,
                createdAt: createdAt,
                updatedAt: updatedAt,
                rowid: rowid,
              ),
          withReferenceMapper: (p0) => p0
              .map(
                (e) => (
                  e.readTable<$LocalFieldReportsTable, LocalFieldReport>(table),
                  BaseReferences<
                    _$AppDatabase,
                    $LocalFieldReportsTable,
                    LocalFieldReport
                  >(db, table, e),
                ),
              )
              .toList(),
          prefetchHooksCallback: null,
        ),
      );
}

typedef $$LocalFieldReportsTableProcessedTableManager =
    ProcessedTableManager<
      _$AppDatabase,
      $LocalFieldReportsTable,
      LocalFieldReport,
      $$LocalFieldReportsTableFilterComposer,
      $$LocalFieldReportsTableOrderingComposer,
      $$LocalFieldReportsTableAnnotationComposer,
      $$LocalFieldReportsTableCreateCompanionBuilder,
      $$LocalFieldReportsTableUpdateCompanionBuilder,
      (
        LocalFieldReport,
        BaseReferences<
          _$AppDatabase,
          $LocalFieldReportsTable,
          LocalFieldReport
        >,
      ),
      LocalFieldReport,
      PrefetchHooks Function()
    >;
typedef $$FieldUnitsTableCreateCompanionBuilder = FieldUnitsCompanion Function({
  required String userSub,
  required int id,
  required int companyId,
  Value<String> kind,
  Value<String> label,
  Value<String?> unitCode,
  Value<String?> plateDisplay,
  Value<String?> unitType,
  Value<String?> brandModel,
  Value<String?> serialNo,
  Value<String> owner,
  Value<int?> clientId,
  Value<String?> clientName,
  Value<String> status,
  Value<double?> lastHourMeter,
  Value<String?> lastHourMeterAt,
  Value<bool> active,
  Value<String?> updatedAt,
  Value<int> rowid,
});
typedef $$FieldUnitsTableUpdateCompanionBuilder = FieldUnitsCompanion Function({
  Value<String> userSub,
  Value<int> id,
  Value<int> companyId,
  Value<String> kind,
  Value<String> label,
  Value<String?> unitCode,
  Value<String?> plateDisplay,
  Value<String?> unitType,
  Value<String?> brandModel,
  Value<String?> serialNo,
  Value<String> owner,
  Value<int?> clientId,
  Value<String?> clientName,
  Value<String> status,
  Value<double?> lastHourMeter,
  Value<String?> lastHourMeterAt,
  Value<bool> active,
  Value<String?> updatedAt,
  Value<int> rowid,
});

class $$FieldUnitsTableFilterComposer
    extends Composer<_$AppDatabase, $FieldUnitsTable> {
  $$FieldUnitsTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get userSub => $composableBuilder(
    column: $table.userSub,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get id => $composableBuilder(
    column: $table.id,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get companyId => $composableBuilder(
    column: $table.companyId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get kind => $composableBuilder(
    column: $table.kind,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get label => $composableBuilder(
    column: $table.label,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get unitCode => $composableBuilder(
    column: $table.unitCode,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get plateDisplay => $composableBuilder(
    column: $table.plateDisplay,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get unitType => $composableBuilder(
    column: $table.unitType,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get brandModel => $composableBuilder(
    column: $table.brandModel,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get serialNo => $composableBuilder(
    column: $table.serialNo,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get owner => $composableBuilder(
    column: $table.owner,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get clientId => $composableBuilder(
    column: $table.clientId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get clientName => $composableBuilder(
    column: $table.clientName,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get status => $composableBuilder(
    column: $table.status,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<double> get lastHourMeter => $composableBuilder(
    column: $table.lastHourMeter,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get lastHourMeterAt => $composableBuilder(
    column: $table.lastHourMeterAt,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<bool> get active => $composableBuilder(
    column: $table.active,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get updatedAt => $composableBuilder(
    column: $table.updatedAt,
    builder: (column) => ColumnFilters(column),
  );
}

class $$FieldUnitsTableOrderingComposer
    extends Composer<_$AppDatabase, $FieldUnitsTable> {
  $$FieldUnitsTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get userSub => $composableBuilder(
    column: $table.userSub,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get id => $composableBuilder(
    column: $table.id,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get companyId => $composableBuilder(
    column: $table.companyId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get kind => $composableBuilder(
    column: $table.kind,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get label => $composableBuilder(
    column: $table.label,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get unitCode => $composableBuilder(
    column: $table.unitCode,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get plateDisplay => $composableBuilder(
    column: $table.plateDisplay,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get unitType => $composableBuilder(
    column: $table.unitType,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get brandModel => $composableBuilder(
    column: $table.brandModel,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get serialNo => $composableBuilder(
    column: $table.serialNo,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get owner => $composableBuilder(
    column: $table.owner,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get clientId => $composableBuilder(
    column: $table.clientId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get clientName => $composableBuilder(
    column: $table.clientName,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get status => $composableBuilder(
    column: $table.status,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<double> get lastHourMeter => $composableBuilder(
    column: $table.lastHourMeter,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get lastHourMeterAt => $composableBuilder(
    column: $table.lastHourMeterAt,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<bool> get active => $composableBuilder(
    column: $table.active,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get updatedAt => $composableBuilder(
    column: $table.updatedAt,
    builder: (column) => ColumnOrderings(column),
  );
}

class $$FieldUnitsTableAnnotationComposer
    extends Composer<_$AppDatabase, $FieldUnitsTable> {
  $$FieldUnitsTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get userSub =>
      $composableBuilder(column: $table.userSub, builder: (column) => column);

  GeneratedColumn<int> get id =>
      $composableBuilder(column: $table.id, builder: (column) => column);

  GeneratedColumn<int> get companyId =>
      $composableBuilder(column: $table.companyId, builder: (column) => column);

  GeneratedColumn<String> get kind =>
      $composableBuilder(column: $table.kind, builder: (column) => column);

  GeneratedColumn<String> get label =>
      $composableBuilder(column: $table.label, builder: (column) => column);

  GeneratedColumn<String> get unitCode =>
      $composableBuilder(column: $table.unitCode, builder: (column) => column);

  GeneratedColumn<String> get plateDisplay => $composableBuilder(
    column: $table.plateDisplay,
    builder: (column) => column,
  );

  GeneratedColumn<String> get unitType =>
      $composableBuilder(column: $table.unitType, builder: (column) => column);

  GeneratedColumn<String> get brandModel => $composableBuilder(
    column: $table.brandModel,
    builder: (column) => column,
  );

  GeneratedColumn<String> get serialNo =>
      $composableBuilder(column: $table.serialNo, builder: (column) => column);

  GeneratedColumn<String> get owner =>
      $composableBuilder(column: $table.owner, builder: (column) => column);

  GeneratedColumn<int> get clientId =>
      $composableBuilder(column: $table.clientId, builder: (column) => column);

  GeneratedColumn<String> get clientName => $composableBuilder(
    column: $table.clientName,
    builder: (column) => column,
  );

  GeneratedColumn<String> get status =>
      $composableBuilder(column: $table.status, builder: (column) => column);

  GeneratedColumn<double> get lastHourMeter => $composableBuilder(
    column: $table.lastHourMeter,
    builder: (column) => column,
  );

  GeneratedColumn<String> get lastHourMeterAt => $composableBuilder(
    column: $table.lastHourMeterAt,
    builder: (column) => column,
  );

  GeneratedColumn<bool> get active =>
      $composableBuilder(column: $table.active, builder: (column) => column);

  GeneratedColumn<String> get updatedAt =>
      $composableBuilder(column: $table.updatedAt, builder: (column) => column);
}

class $$FieldUnitsTableTableManager
    extends
        RootTableManager<
          _$AppDatabase,
          $FieldUnitsTable,
          FieldUnitRow,
          $$FieldUnitsTableFilterComposer,
          $$FieldUnitsTableOrderingComposer,
          $$FieldUnitsTableAnnotationComposer,
          $$FieldUnitsTableCreateCompanionBuilder,
          $$FieldUnitsTableUpdateCompanionBuilder,
          (
            FieldUnitRow,
            BaseReferences<_$AppDatabase, $FieldUnitsTable, FieldUnitRow>,
          ),
          FieldUnitRow,
          PrefetchHooks Function()
        > {
  $$FieldUnitsTableTableManager(_$AppDatabase db, $FieldUnitsTable table)
    : super(
        TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$FieldUnitsTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$FieldUnitsTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$FieldUnitsTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback:
              ({
                Value<String> userSub = const Value.absent(),
                Value<int> id = const Value.absent(),
                Value<int> companyId = const Value.absent(),
                Value<String> kind = const Value.absent(),
                Value<String> label = const Value.absent(),
                Value<String?> unitCode = const Value.absent(),
                Value<String?> plateDisplay = const Value.absent(),
                Value<String?> unitType = const Value.absent(),
                Value<String?> brandModel = const Value.absent(),
                Value<String?> serialNo = const Value.absent(),
                Value<String> owner = const Value.absent(),
                Value<int?> clientId = const Value.absent(),
                Value<String?> clientName = const Value.absent(),
                Value<String> status = const Value.absent(),
                Value<double?> lastHourMeter = const Value.absent(),
                Value<String?> lastHourMeterAt = const Value.absent(),
                Value<bool> active = const Value.absent(),
                Value<String?> updatedAt = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => FieldUnitsCompanion(
                userSub: userSub,
                id: id,
                companyId: companyId,
                kind: kind,
                label: label,
                unitCode: unitCode,
                plateDisplay: plateDisplay,
                unitType: unitType,
                brandModel: brandModel,
                serialNo: serialNo,
                owner: owner,
                clientId: clientId,
                clientName: clientName,
                status: status,
                lastHourMeter: lastHourMeter,
                lastHourMeterAt: lastHourMeterAt,
                active: active,
                updatedAt: updatedAt,
                rowid: rowid,
              ),
          createCompanionCallback:
              ({
                required String userSub,
                required int id,
                required int companyId,
                Value<String> kind = const Value.absent(),
                Value<String> label = const Value.absent(),
                Value<String?> unitCode = const Value.absent(),
                Value<String?> plateDisplay = const Value.absent(),
                Value<String?> unitType = const Value.absent(),
                Value<String?> brandModel = const Value.absent(),
                Value<String?> serialNo = const Value.absent(),
                Value<String> owner = const Value.absent(),
                Value<int?> clientId = const Value.absent(),
                Value<String?> clientName = const Value.absent(),
                Value<String> status = const Value.absent(),
                Value<double?> lastHourMeter = const Value.absent(),
                Value<String?> lastHourMeterAt = const Value.absent(),
                Value<bool> active = const Value.absent(),
                Value<String?> updatedAt = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => FieldUnitsCompanion.insert(
                userSub: userSub,
                id: id,
                companyId: companyId,
                kind: kind,
                label: label,
                unitCode: unitCode,
                plateDisplay: plateDisplay,
                unitType: unitType,
                brandModel: brandModel,
                serialNo: serialNo,
                owner: owner,
                clientId: clientId,
                clientName: clientName,
                status: status,
                lastHourMeter: lastHourMeter,
                lastHourMeterAt: lastHourMeterAt,
                active: active,
                updatedAt: updatedAt,
                rowid: rowid,
              ),
          withReferenceMapper: (p0) => p0
              .map(
                (e) => (
                  e.readTable<$FieldUnitsTable, FieldUnitRow>(table),
                  BaseReferences<_$AppDatabase, $FieldUnitsTable, FieldUnitRow>(
                    db,
                    table,
                    e,
                  ),
                ),
              )
              .toList(),
          prefetchHooksCallback: null,
        ),
      );
}

typedef $$FieldUnitsTableProcessedTableManager =
    ProcessedTableManager<
      _$AppDatabase,
      $FieldUnitsTable,
      FieldUnitRow,
      $$FieldUnitsTableFilterComposer,
      $$FieldUnitsTableOrderingComposer,
      $$FieldUnitsTableAnnotationComposer,
      $$FieldUnitsTableCreateCompanionBuilder,
      $$FieldUnitsTableUpdateCompanionBuilder,
      (
        FieldUnitRow,
        BaseReferences<_$AppDatabase, $FieldUnitsTable, FieldUnitRow>,
      ),
      FieldUnitRow,
      PrefetchHooks Function()
    >;
typedef $$FieldContractUnitsTableCreateCompanionBuilder =
    FieldContractUnitsCompanion Function({
      required String userSub,
      required int id,
      required int companyId,
      required int projectId,
      required int unitId,
      Value<String> unitLabel,
      Value<String?> unitCode,
      required String startDate,
      Value<String?> endDate,
      Value<bool> active,
      Value<int> rowid,
    });
typedef $$FieldContractUnitsTableUpdateCompanionBuilder =
    FieldContractUnitsCompanion Function({
      Value<String> userSub,
      Value<int> id,
      Value<int> companyId,
      Value<int> projectId,
      Value<int> unitId,
      Value<String> unitLabel,
      Value<String?> unitCode,
      Value<String> startDate,
      Value<String?> endDate,
      Value<bool> active,
      Value<int> rowid,
    });

class $$FieldContractUnitsTableFilterComposer
    extends Composer<_$AppDatabase, $FieldContractUnitsTable> {
  $$FieldContractUnitsTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get userSub => $composableBuilder(
    column: $table.userSub,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get id => $composableBuilder(
    column: $table.id,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get companyId => $composableBuilder(
    column: $table.companyId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get projectId => $composableBuilder(
    column: $table.projectId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get unitId => $composableBuilder(
    column: $table.unitId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get unitLabel => $composableBuilder(
    column: $table.unitLabel,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get unitCode => $composableBuilder(
    column: $table.unitCode,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get startDate => $composableBuilder(
    column: $table.startDate,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get endDate => $composableBuilder(
    column: $table.endDate,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<bool> get active => $composableBuilder(
    column: $table.active,
    builder: (column) => ColumnFilters(column),
  );
}

class $$FieldContractUnitsTableOrderingComposer
    extends Composer<_$AppDatabase, $FieldContractUnitsTable> {
  $$FieldContractUnitsTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get userSub => $composableBuilder(
    column: $table.userSub,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get id => $composableBuilder(
    column: $table.id,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get companyId => $composableBuilder(
    column: $table.companyId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get projectId => $composableBuilder(
    column: $table.projectId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get unitId => $composableBuilder(
    column: $table.unitId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get unitLabel => $composableBuilder(
    column: $table.unitLabel,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get unitCode => $composableBuilder(
    column: $table.unitCode,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get startDate => $composableBuilder(
    column: $table.startDate,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get endDate => $composableBuilder(
    column: $table.endDate,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<bool> get active => $composableBuilder(
    column: $table.active,
    builder: (column) => ColumnOrderings(column),
  );
}

class $$FieldContractUnitsTableAnnotationComposer
    extends Composer<_$AppDatabase, $FieldContractUnitsTable> {
  $$FieldContractUnitsTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get userSub =>
      $composableBuilder(column: $table.userSub, builder: (column) => column);

  GeneratedColumn<int> get id =>
      $composableBuilder(column: $table.id, builder: (column) => column);

  GeneratedColumn<int> get companyId =>
      $composableBuilder(column: $table.companyId, builder: (column) => column);

  GeneratedColumn<int> get projectId =>
      $composableBuilder(column: $table.projectId, builder: (column) => column);

  GeneratedColumn<int> get unitId =>
      $composableBuilder(column: $table.unitId, builder: (column) => column);

  GeneratedColumn<String> get unitLabel =>
      $composableBuilder(column: $table.unitLabel, builder: (column) => column);

  GeneratedColumn<String> get unitCode =>
      $composableBuilder(column: $table.unitCode, builder: (column) => column);

  GeneratedColumn<String> get startDate =>
      $composableBuilder(column: $table.startDate, builder: (column) => column);

  GeneratedColumn<String> get endDate =>
      $composableBuilder(column: $table.endDate, builder: (column) => column);

  GeneratedColumn<bool> get active =>
      $composableBuilder(column: $table.active, builder: (column) => column);
}

class $$FieldContractUnitsTableTableManager
    extends
        RootTableManager<
          _$AppDatabase,
          $FieldContractUnitsTable,
          FieldContractUnitRow,
          $$FieldContractUnitsTableFilterComposer,
          $$FieldContractUnitsTableOrderingComposer,
          $$FieldContractUnitsTableAnnotationComposer,
          $$FieldContractUnitsTableCreateCompanionBuilder,
          $$FieldContractUnitsTableUpdateCompanionBuilder,
          (
            FieldContractUnitRow,
            BaseReferences<
              _$AppDatabase,
              $FieldContractUnitsTable,
              FieldContractUnitRow
            >,
          ),
          FieldContractUnitRow,
          PrefetchHooks Function()
        > {
  $$FieldContractUnitsTableTableManager(
    _$AppDatabase db,
    $FieldContractUnitsTable table,
  ) : super(
        TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$FieldContractUnitsTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$FieldContractUnitsTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$FieldContractUnitsTableAnnotationComposer(
                $db: db,
                $table: table,
              ),
          updateCompanionCallback:
              ({
                Value<String> userSub = const Value.absent(),
                Value<int> id = const Value.absent(),
                Value<int> companyId = const Value.absent(),
                Value<int> projectId = const Value.absent(),
                Value<int> unitId = const Value.absent(),
                Value<String> unitLabel = const Value.absent(),
                Value<String?> unitCode = const Value.absent(),
                Value<String> startDate = const Value.absent(),
                Value<String?> endDate = const Value.absent(),
                Value<bool> active = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => FieldContractUnitsCompanion(
                userSub: userSub,
                id: id,
                companyId: companyId,
                projectId: projectId,
                unitId: unitId,
                unitLabel: unitLabel,
                unitCode: unitCode,
                startDate: startDate,
                endDate: endDate,
                active: active,
                rowid: rowid,
              ),
          createCompanionCallback:
              ({
                required String userSub,
                required int id,
                required int companyId,
                required int projectId,
                required int unitId,
                Value<String> unitLabel = const Value.absent(),
                Value<String?> unitCode = const Value.absent(),
                required String startDate,
                Value<String?> endDate = const Value.absent(),
                Value<bool> active = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => FieldContractUnitsCompanion.insert(
                userSub: userSub,
                id: id,
                companyId: companyId,
                projectId: projectId,
                unitId: unitId,
                unitLabel: unitLabel,
                unitCode: unitCode,
                startDate: startDate,
                endDate: endDate,
                active: active,
                rowid: rowid,
              ),
          withReferenceMapper: (p0) => p0
              .map(
                (e) => (
                  e.readTable<$FieldContractUnitsTable, FieldContractUnitRow>(
                    table,
                  ),
                  BaseReferences<
                    _$AppDatabase,
                    $FieldContractUnitsTable,
                    FieldContractUnitRow
                  >(db, table, e),
                ),
              )
              .toList(),
          prefetchHooksCallback: null,
        ),
      );
}

typedef $$FieldContractUnitsTableProcessedTableManager =
    ProcessedTableManager<
      _$AppDatabase,
      $FieldContractUnitsTable,
      FieldContractUnitRow,
      $$FieldContractUnitsTableFilterComposer,
      $$FieldContractUnitsTableOrderingComposer,
      $$FieldContractUnitsTableAnnotationComposer,
      $$FieldContractUnitsTableCreateCompanionBuilder,
      $$FieldContractUnitsTableUpdateCompanionBuilder,
      (
        FieldContractUnitRow,
        BaseReferences<
          _$AppDatabase,
          $FieldContractUnitsTable,
          FieldContractUnitRow
        >,
      ),
      FieldContractUnitRow,
      PrefetchHooks Function()
    >;
typedef $$FieldOpenPosTableCreateCompanionBuilder =
    FieldOpenPosCompanion Function({
      required String userSub,
      required int id,
      required int companyId,
      required int projectId,
      required int clientId,
      Value<String> clientName,
      required String activityDate,
      Value<String?> docNo,
      Value<String> itemsJson,
      Value<String> poStatus,
      Value<int> ageDays,
      Value<int> deliveries,
      Value<int> rowid,
    });
typedef $$FieldOpenPosTableUpdateCompanionBuilder =
    FieldOpenPosCompanion Function({
      Value<String> userSub,
      Value<int> id,
      Value<int> companyId,
      Value<int> projectId,
      Value<int> clientId,
      Value<String> clientName,
      Value<String> activityDate,
      Value<String?> docNo,
      Value<String> itemsJson,
      Value<String> poStatus,
      Value<int> ageDays,
      Value<int> deliveries,
      Value<int> rowid,
    });

class $$FieldOpenPosTableFilterComposer
    extends Composer<_$AppDatabase, $FieldOpenPosTable> {
  $$FieldOpenPosTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get userSub => $composableBuilder(
    column: $table.userSub,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get id => $composableBuilder(
    column: $table.id,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get companyId => $composableBuilder(
    column: $table.companyId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get projectId => $composableBuilder(
    column: $table.projectId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get clientId => $composableBuilder(
    column: $table.clientId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get clientName => $composableBuilder(
    column: $table.clientName,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get activityDate => $composableBuilder(
    column: $table.activityDate,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get docNo => $composableBuilder(
    column: $table.docNo,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get itemsJson => $composableBuilder(
    column: $table.itemsJson,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get poStatus => $composableBuilder(
    column: $table.poStatus,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get ageDays => $composableBuilder(
    column: $table.ageDays,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get deliveries => $composableBuilder(
    column: $table.deliveries,
    builder: (column) => ColumnFilters(column),
  );
}

class $$FieldOpenPosTableOrderingComposer
    extends Composer<_$AppDatabase, $FieldOpenPosTable> {
  $$FieldOpenPosTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get userSub => $composableBuilder(
    column: $table.userSub,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get id => $composableBuilder(
    column: $table.id,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get companyId => $composableBuilder(
    column: $table.companyId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get projectId => $composableBuilder(
    column: $table.projectId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get clientId => $composableBuilder(
    column: $table.clientId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get clientName => $composableBuilder(
    column: $table.clientName,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get activityDate => $composableBuilder(
    column: $table.activityDate,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get docNo => $composableBuilder(
    column: $table.docNo,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get itemsJson => $composableBuilder(
    column: $table.itemsJson,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get poStatus => $composableBuilder(
    column: $table.poStatus,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get ageDays => $composableBuilder(
    column: $table.ageDays,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get deliveries => $composableBuilder(
    column: $table.deliveries,
    builder: (column) => ColumnOrderings(column),
  );
}

class $$FieldOpenPosTableAnnotationComposer
    extends Composer<_$AppDatabase, $FieldOpenPosTable> {
  $$FieldOpenPosTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get userSub =>
      $composableBuilder(column: $table.userSub, builder: (column) => column);

  GeneratedColumn<int> get id =>
      $composableBuilder(column: $table.id, builder: (column) => column);

  GeneratedColumn<int> get companyId =>
      $composableBuilder(column: $table.companyId, builder: (column) => column);

  GeneratedColumn<int> get projectId =>
      $composableBuilder(column: $table.projectId, builder: (column) => column);

  GeneratedColumn<int> get clientId =>
      $composableBuilder(column: $table.clientId, builder: (column) => column);

  GeneratedColumn<String> get clientName => $composableBuilder(
    column: $table.clientName,
    builder: (column) => column,
  );

  GeneratedColumn<String> get activityDate => $composableBuilder(
    column: $table.activityDate,
    builder: (column) => column,
  );

  GeneratedColumn<String> get docNo =>
      $composableBuilder(column: $table.docNo, builder: (column) => column);

  GeneratedColumn<String> get itemsJson =>
      $composableBuilder(column: $table.itemsJson, builder: (column) => column);

  GeneratedColumn<String> get poStatus =>
      $composableBuilder(column: $table.poStatus, builder: (column) => column);

  GeneratedColumn<int> get ageDays =>
      $composableBuilder(column: $table.ageDays, builder: (column) => column);

  GeneratedColumn<int> get deliveries => $composableBuilder(
    column: $table.deliveries,
    builder: (column) => column,
  );
}

class $$FieldOpenPosTableTableManager
    extends
        RootTableManager<
          _$AppDatabase,
          $FieldOpenPosTable,
          FieldOpenPoRow,
          $$FieldOpenPosTableFilterComposer,
          $$FieldOpenPosTableOrderingComposer,
          $$FieldOpenPosTableAnnotationComposer,
          $$FieldOpenPosTableCreateCompanionBuilder,
          $$FieldOpenPosTableUpdateCompanionBuilder,
          (
            FieldOpenPoRow,
            BaseReferences<_$AppDatabase, $FieldOpenPosTable, FieldOpenPoRow>,
          ),
          FieldOpenPoRow,
          PrefetchHooks Function()
        > {
  $$FieldOpenPosTableTableManager(_$AppDatabase db, $FieldOpenPosTable table)
    : super(
        TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$FieldOpenPosTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$FieldOpenPosTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$FieldOpenPosTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback:
              ({
                Value<String> userSub = const Value.absent(),
                Value<int> id = const Value.absent(),
                Value<int> companyId = const Value.absent(),
                Value<int> projectId = const Value.absent(),
                Value<int> clientId = const Value.absent(),
                Value<String> clientName = const Value.absent(),
                Value<String> activityDate = const Value.absent(),
                Value<String?> docNo = const Value.absent(),
                Value<String> itemsJson = const Value.absent(),
                Value<String> poStatus = const Value.absent(),
                Value<int> ageDays = const Value.absent(),
                Value<int> deliveries = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => FieldOpenPosCompanion(
                userSub: userSub,
                id: id,
                companyId: companyId,
                projectId: projectId,
                clientId: clientId,
                clientName: clientName,
                activityDate: activityDate,
                docNo: docNo,
                itemsJson: itemsJson,
                poStatus: poStatus,
                ageDays: ageDays,
                deliveries: deliveries,
                rowid: rowid,
              ),
          createCompanionCallback:
              ({
                required String userSub,
                required int id,
                required int companyId,
                required int projectId,
                required int clientId,
                Value<String> clientName = const Value.absent(),
                required String activityDate,
                Value<String?> docNo = const Value.absent(),
                Value<String> itemsJson = const Value.absent(),
                Value<String> poStatus = const Value.absent(),
                Value<int> ageDays = const Value.absent(),
                Value<int> deliveries = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => FieldOpenPosCompanion.insert(
                userSub: userSub,
                id: id,
                companyId: companyId,
                projectId: projectId,
                clientId: clientId,
                clientName: clientName,
                activityDate: activityDate,
                docNo: docNo,
                itemsJson: itemsJson,
                poStatus: poStatus,
                ageDays: ageDays,
                deliveries: deliveries,
                rowid: rowid,
              ),
          withReferenceMapper: (p0) => p0
              .map(
                (e) => (
                  e.readTable<$FieldOpenPosTable, FieldOpenPoRow>(table),
                  BaseReferences<
                    _$AppDatabase,
                    $FieldOpenPosTable,
                    FieldOpenPoRow
                  >(db, table, e),
                ),
              )
              .toList(),
          prefetchHooksCallback: null,
        ),
      );
}

typedef $$FieldOpenPosTableProcessedTableManager =
    ProcessedTableManager<
      _$AppDatabase,
      $FieldOpenPosTable,
      FieldOpenPoRow,
      $$FieldOpenPosTableFilterComposer,
      $$FieldOpenPosTableOrderingComposer,
      $$FieldOpenPosTableAnnotationComposer,
      $$FieldOpenPosTableCreateCompanionBuilder,
      $$FieldOpenPosTableUpdateCompanionBuilder,
      (
        FieldOpenPoRow,
        BaseReferences<_$AppDatabase, $FieldOpenPosTable, FieldOpenPoRow>,
      ),
      FieldOpenPoRow,
      PrefetchHooks Function()
    >;
typedef $$FieldClientsTableCreateCompanionBuilder =
    FieldClientsCompanion Function({
      required String userSub,
      required int id,
      required int companyId,
      Value<String> name,
      Value<int> rowid,
    });
typedef $$FieldClientsTableUpdateCompanionBuilder =
    FieldClientsCompanion Function({
      Value<String> userSub,
      Value<int> id,
      Value<int> companyId,
      Value<String> name,
      Value<int> rowid,
    });

class $$FieldClientsTableFilterComposer
    extends Composer<_$AppDatabase, $FieldClientsTable> {
  $$FieldClientsTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get userSub => $composableBuilder(
    column: $table.userSub,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get id => $composableBuilder(
    column: $table.id,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get companyId => $composableBuilder(
    column: $table.companyId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get name => $composableBuilder(
    column: $table.name,
    builder: (column) => ColumnFilters(column),
  );
}

class $$FieldClientsTableOrderingComposer
    extends Composer<_$AppDatabase, $FieldClientsTable> {
  $$FieldClientsTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get userSub => $composableBuilder(
    column: $table.userSub,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get id => $composableBuilder(
    column: $table.id,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get companyId => $composableBuilder(
    column: $table.companyId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get name => $composableBuilder(
    column: $table.name,
    builder: (column) => ColumnOrderings(column),
  );
}

class $$FieldClientsTableAnnotationComposer
    extends Composer<_$AppDatabase, $FieldClientsTable> {
  $$FieldClientsTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get userSub =>
      $composableBuilder(column: $table.userSub, builder: (column) => column);

  GeneratedColumn<int> get id =>
      $composableBuilder(column: $table.id, builder: (column) => column);

  GeneratedColumn<int> get companyId =>
      $composableBuilder(column: $table.companyId, builder: (column) => column);

  GeneratedColumn<String> get name =>
      $composableBuilder(column: $table.name, builder: (column) => column);
}

class $$FieldClientsTableTableManager
    extends
        RootTableManager<
          _$AppDatabase,
          $FieldClientsTable,
          FieldClientRow,
          $$FieldClientsTableFilterComposer,
          $$FieldClientsTableOrderingComposer,
          $$FieldClientsTableAnnotationComposer,
          $$FieldClientsTableCreateCompanionBuilder,
          $$FieldClientsTableUpdateCompanionBuilder,
          (
            FieldClientRow,
            BaseReferences<_$AppDatabase, $FieldClientsTable, FieldClientRow>,
          ),
          FieldClientRow,
          PrefetchHooks Function()
        > {
  $$FieldClientsTableTableManager(_$AppDatabase db, $FieldClientsTable table)
    : super(
        TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$FieldClientsTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$FieldClientsTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$FieldClientsTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback:
              ({
                Value<String> userSub = const Value.absent(),
                Value<int> id = const Value.absent(),
                Value<int> companyId = const Value.absent(),
                Value<String> name = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => FieldClientsCompanion(
                userSub: userSub,
                id: id,
                companyId: companyId,
                name: name,
                rowid: rowid,
              ),
          createCompanionCallback:
              ({
                required String userSub,
                required int id,
                required int companyId,
                Value<String> name = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => FieldClientsCompanion.insert(
                userSub: userSub,
                id: id,
                companyId: companyId,
                name: name,
                rowid: rowid,
              ),
          withReferenceMapper: (p0) => p0
              .map(
                (e) => (
                  e.readTable<$FieldClientsTable, FieldClientRow>(table),
                  BaseReferences<
                    _$AppDatabase,
                    $FieldClientsTable,
                    FieldClientRow
                  >(db, table, e),
                ),
              )
              .toList(),
          prefetchHooksCallback: null,
        ),
      );
}

typedef $$FieldClientsTableProcessedTableManager =
    ProcessedTableManager<
      _$AppDatabase,
      $FieldClientsTable,
      FieldClientRow,
      $$FieldClientsTableFilterComposer,
      $$FieldClientsTableOrderingComposer,
      $$FieldClientsTableAnnotationComposer,
      $$FieldClientsTableCreateCompanionBuilder,
      $$FieldClientsTableUpdateCompanionBuilder,
      (
        FieldClientRow,
        BaseReferences<_$AppDatabase, $FieldClientsTable, FieldClientRow>,
      ),
      FieldClientRow,
      PrefetchHooks Function()
    >;
typedef $$FieldRecentTimesheetsTableCreateCompanionBuilder =
    FieldRecentTimesheetsCompanion Function({
      required String userSub,
      required int id,
      required int companyId,
      required int projectId,
      required int unitId,
      required String reportDate,
      Value<double?> hmStart,
      Value<double?> hmEnd,
      Value<String?> operatorName,
      Value<String?> location,
      Value<double?> fuelLiters,
      Value<int> rowid,
    });
typedef $$FieldRecentTimesheetsTableUpdateCompanionBuilder =
    FieldRecentTimesheetsCompanion Function({
      Value<String> userSub,
      Value<int> id,
      Value<int> companyId,
      Value<int> projectId,
      Value<int> unitId,
      Value<String> reportDate,
      Value<double?> hmStart,
      Value<double?> hmEnd,
      Value<String?> operatorName,
      Value<String?> location,
      Value<double?> fuelLiters,
      Value<int> rowid,
    });

class $$FieldRecentTimesheetsTableFilterComposer
    extends Composer<_$AppDatabase, $FieldRecentTimesheetsTable> {
  $$FieldRecentTimesheetsTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get userSub => $composableBuilder(
    column: $table.userSub,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get id => $composableBuilder(
    column: $table.id,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get companyId => $composableBuilder(
    column: $table.companyId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get projectId => $composableBuilder(
    column: $table.projectId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get unitId => $composableBuilder(
    column: $table.unitId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get reportDate => $composableBuilder(
    column: $table.reportDate,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<double> get hmStart => $composableBuilder(
    column: $table.hmStart,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<double> get hmEnd => $composableBuilder(
    column: $table.hmEnd,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get operatorName => $composableBuilder(
    column: $table.operatorName,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get location => $composableBuilder(
    column: $table.location,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<double> get fuelLiters => $composableBuilder(
    column: $table.fuelLiters,
    builder: (column) => ColumnFilters(column),
  );
}

class $$FieldRecentTimesheetsTableOrderingComposer
    extends Composer<_$AppDatabase, $FieldRecentTimesheetsTable> {
  $$FieldRecentTimesheetsTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get userSub => $composableBuilder(
    column: $table.userSub,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get id => $composableBuilder(
    column: $table.id,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get companyId => $composableBuilder(
    column: $table.companyId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get projectId => $composableBuilder(
    column: $table.projectId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get unitId => $composableBuilder(
    column: $table.unitId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get reportDate => $composableBuilder(
    column: $table.reportDate,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<double> get hmStart => $composableBuilder(
    column: $table.hmStart,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<double> get hmEnd => $composableBuilder(
    column: $table.hmEnd,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get operatorName => $composableBuilder(
    column: $table.operatorName,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get location => $composableBuilder(
    column: $table.location,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<double> get fuelLiters => $composableBuilder(
    column: $table.fuelLiters,
    builder: (column) => ColumnOrderings(column),
  );
}

class $$FieldRecentTimesheetsTableAnnotationComposer
    extends Composer<_$AppDatabase, $FieldRecentTimesheetsTable> {
  $$FieldRecentTimesheetsTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get userSub =>
      $composableBuilder(column: $table.userSub, builder: (column) => column);

  GeneratedColumn<int> get id =>
      $composableBuilder(column: $table.id, builder: (column) => column);

  GeneratedColumn<int> get companyId =>
      $composableBuilder(column: $table.companyId, builder: (column) => column);

  GeneratedColumn<int> get projectId =>
      $composableBuilder(column: $table.projectId, builder: (column) => column);

  GeneratedColumn<int> get unitId =>
      $composableBuilder(column: $table.unitId, builder: (column) => column);

  GeneratedColumn<String> get reportDate => $composableBuilder(
    column: $table.reportDate,
    builder: (column) => column,
  );

  GeneratedColumn<double> get hmStart =>
      $composableBuilder(column: $table.hmStart, builder: (column) => column);

  GeneratedColumn<double> get hmEnd =>
      $composableBuilder(column: $table.hmEnd, builder: (column) => column);

  GeneratedColumn<String> get operatorName => $composableBuilder(
    column: $table.operatorName,
    builder: (column) => column,
  );

  GeneratedColumn<String> get location =>
      $composableBuilder(column: $table.location, builder: (column) => column);

  GeneratedColumn<double> get fuelLiters => $composableBuilder(
    column: $table.fuelLiters,
    builder: (column) => column,
  );
}

class $$FieldRecentTimesheetsTableTableManager
    extends
        RootTableManager<
          _$AppDatabase,
          $FieldRecentTimesheetsTable,
          FieldRecentTimesheetRow,
          $$FieldRecentTimesheetsTableFilterComposer,
          $$FieldRecentTimesheetsTableOrderingComposer,
          $$FieldRecentTimesheetsTableAnnotationComposer,
          $$FieldRecentTimesheetsTableCreateCompanionBuilder,
          $$FieldRecentTimesheetsTableUpdateCompanionBuilder,
          (
            FieldRecentTimesheetRow,
            BaseReferences<
              _$AppDatabase,
              $FieldRecentTimesheetsTable,
              FieldRecentTimesheetRow
            >,
          ),
          FieldRecentTimesheetRow,
          PrefetchHooks Function()
        > {
  $$FieldRecentTimesheetsTableTableManager(
    _$AppDatabase db,
    $FieldRecentTimesheetsTable table,
  ) : super(
        TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$FieldRecentTimesheetsTableFilterComposer(
                $db: db,
                $table: table,
              ),
          createOrderingComposer: () =>
              $$FieldRecentTimesheetsTableOrderingComposer(
                $db: db,
                $table: table,
              ),
          createComputedFieldComposer: () =>
              $$FieldRecentTimesheetsTableAnnotationComposer(
                $db: db,
                $table: table,
              ),
          updateCompanionCallback:
              ({
                Value<String> userSub = const Value.absent(),
                Value<int> id = const Value.absent(),
                Value<int> companyId = const Value.absent(),
                Value<int> projectId = const Value.absent(),
                Value<int> unitId = const Value.absent(),
                Value<String> reportDate = const Value.absent(),
                Value<double?> hmStart = const Value.absent(),
                Value<double?> hmEnd = const Value.absent(),
                Value<String?> operatorName = const Value.absent(),
                Value<String?> location = const Value.absent(),
                Value<double?> fuelLiters = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => FieldRecentTimesheetsCompanion(
                userSub: userSub,
                id: id,
                companyId: companyId,
                projectId: projectId,
                unitId: unitId,
                reportDate: reportDate,
                hmStart: hmStart,
                hmEnd: hmEnd,
                operatorName: operatorName,
                location: location,
                fuelLiters: fuelLiters,
                rowid: rowid,
              ),
          createCompanionCallback:
              ({
                required String userSub,
                required int id,
                required int companyId,
                required int projectId,
                required int unitId,
                required String reportDate,
                Value<double?> hmStart = const Value.absent(),
                Value<double?> hmEnd = const Value.absent(),
                Value<String?> operatorName = const Value.absent(),
                Value<String?> location = const Value.absent(),
                Value<double?> fuelLiters = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => FieldRecentTimesheetsCompanion.insert(
                userSub: userSub,
                id: id,
                companyId: companyId,
                projectId: projectId,
                unitId: unitId,
                reportDate: reportDate,
                hmStart: hmStart,
                hmEnd: hmEnd,
                operatorName: operatorName,
                location: location,
                fuelLiters: fuelLiters,
                rowid: rowid,
              ),
          withReferenceMapper: (p0) => p0
              .map(
                (e) => (
                  e.readTable<
                    $FieldRecentTimesheetsTable,
                    FieldRecentTimesheetRow
                  >(table),
                  BaseReferences<
                    _$AppDatabase,
                    $FieldRecentTimesheetsTable,
                    FieldRecentTimesheetRow
                  >(db, table, e),
                ),
              )
              .toList(),
          prefetchHooksCallback: null,
        ),
      );
}

typedef $$FieldRecentTimesheetsTableProcessedTableManager =
    ProcessedTableManager<
      _$AppDatabase,
      $FieldRecentTimesheetsTable,
      FieldRecentTimesheetRow,
      $$FieldRecentTimesheetsTableFilterComposer,
      $$FieldRecentTimesheetsTableOrderingComposer,
      $$FieldRecentTimesheetsTableAnnotationComposer,
      $$FieldRecentTimesheetsTableCreateCompanionBuilder,
      $$FieldRecentTimesheetsTableUpdateCompanionBuilder,
      (
        FieldRecentTimesheetRow,
        BaseReferences<
          _$AppDatabase,
          $FieldRecentTimesheetsTable,
          FieldRecentTimesheetRow
        >,
      ),
      FieldRecentTimesheetRow,
      PrefetchHooks Function()
    >;
typedef $$FieldRapItemsTableCreateCompanionBuilder =
    FieldRapItemsCompanion Function({
      required String userSub,
      required int id,
      required int companyId,
      required int projectId,
      required String code,
      Value<String> description,
      required String kind,
      Value<String> uom,
      Value<String> stageName,
      Value<double> volume,
      Value<double> realised,
      Value<double> received,
      Value<double> used,
      Value<int> sortOrder,
      Value<bool> active,
      Value<int> rowid,
    });
typedef $$FieldRapItemsTableUpdateCompanionBuilder =
    FieldRapItemsCompanion Function({
      Value<String> userSub,
      Value<int> id,
      Value<int> companyId,
      Value<int> projectId,
      Value<String> code,
      Value<String> description,
      Value<String> kind,
      Value<String> uom,
      Value<String> stageName,
      Value<double> volume,
      Value<double> realised,
      Value<double> received,
      Value<double> used,
      Value<int> sortOrder,
      Value<bool> active,
      Value<int> rowid,
    });

class $$FieldRapItemsTableFilterComposer
    extends Composer<_$AppDatabase, $FieldRapItemsTable> {
  $$FieldRapItemsTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get userSub => $composableBuilder(
    column: $table.userSub,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get id => $composableBuilder(
    column: $table.id,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get companyId => $composableBuilder(
    column: $table.companyId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get projectId => $composableBuilder(
    column: $table.projectId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get code => $composableBuilder(
    column: $table.code,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get description => $composableBuilder(
    column: $table.description,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get kind => $composableBuilder(
    column: $table.kind,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get uom => $composableBuilder(
    column: $table.uom,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get stageName => $composableBuilder(
    column: $table.stageName,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<double> get volume => $composableBuilder(
    column: $table.volume,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<double> get realised => $composableBuilder(
    column: $table.realised,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<double> get received => $composableBuilder(
    column: $table.received,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<double> get used => $composableBuilder(
    column: $table.used,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get sortOrder => $composableBuilder(
    column: $table.sortOrder,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<bool> get active => $composableBuilder(
    column: $table.active,
    builder: (column) => ColumnFilters(column),
  );
}

class $$FieldRapItemsTableOrderingComposer
    extends Composer<_$AppDatabase, $FieldRapItemsTable> {
  $$FieldRapItemsTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get userSub => $composableBuilder(
    column: $table.userSub,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get id => $composableBuilder(
    column: $table.id,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get companyId => $composableBuilder(
    column: $table.companyId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get projectId => $composableBuilder(
    column: $table.projectId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get code => $composableBuilder(
    column: $table.code,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get description => $composableBuilder(
    column: $table.description,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get kind => $composableBuilder(
    column: $table.kind,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get uom => $composableBuilder(
    column: $table.uom,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get stageName => $composableBuilder(
    column: $table.stageName,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<double> get volume => $composableBuilder(
    column: $table.volume,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<double> get realised => $composableBuilder(
    column: $table.realised,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<double> get received => $composableBuilder(
    column: $table.received,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<double> get used => $composableBuilder(
    column: $table.used,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get sortOrder => $composableBuilder(
    column: $table.sortOrder,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<bool> get active => $composableBuilder(
    column: $table.active,
    builder: (column) => ColumnOrderings(column),
  );
}

class $$FieldRapItemsTableAnnotationComposer
    extends Composer<_$AppDatabase, $FieldRapItemsTable> {
  $$FieldRapItemsTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get userSub =>
      $composableBuilder(column: $table.userSub, builder: (column) => column);

  GeneratedColumn<int> get id =>
      $composableBuilder(column: $table.id, builder: (column) => column);

  GeneratedColumn<int> get companyId =>
      $composableBuilder(column: $table.companyId, builder: (column) => column);

  GeneratedColumn<int> get projectId =>
      $composableBuilder(column: $table.projectId, builder: (column) => column);

  GeneratedColumn<String> get code =>
      $composableBuilder(column: $table.code, builder: (column) => column);

  GeneratedColumn<String> get description => $composableBuilder(
    column: $table.description,
    builder: (column) => column,
  );

  GeneratedColumn<String> get kind =>
      $composableBuilder(column: $table.kind, builder: (column) => column);

  GeneratedColumn<String> get uom =>
      $composableBuilder(column: $table.uom, builder: (column) => column);

  GeneratedColumn<String> get stageName =>
      $composableBuilder(column: $table.stageName, builder: (column) => column);

  GeneratedColumn<double> get volume =>
      $composableBuilder(column: $table.volume, builder: (column) => column);

  GeneratedColumn<double> get realised =>
      $composableBuilder(column: $table.realised, builder: (column) => column);

  GeneratedColumn<double> get received =>
      $composableBuilder(column: $table.received, builder: (column) => column);

  GeneratedColumn<double> get used =>
      $composableBuilder(column: $table.used, builder: (column) => column);

  GeneratedColumn<int> get sortOrder =>
      $composableBuilder(column: $table.sortOrder, builder: (column) => column);

  GeneratedColumn<bool> get active =>
      $composableBuilder(column: $table.active, builder: (column) => column);
}

class $$FieldRapItemsTableTableManager
    extends
        RootTableManager<
          _$AppDatabase,
          $FieldRapItemsTable,
          FieldRapItemRow,
          $$FieldRapItemsTableFilterComposer,
          $$FieldRapItemsTableOrderingComposer,
          $$FieldRapItemsTableAnnotationComposer,
          $$FieldRapItemsTableCreateCompanionBuilder,
          $$FieldRapItemsTableUpdateCompanionBuilder,
          (
            FieldRapItemRow,
            BaseReferences<_$AppDatabase, $FieldRapItemsTable, FieldRapItemRow>,
          ),
          FieldRapItemRow,
          PrefetchHooks Function()
        > {
  $$FieldRapItemsTableTableManager(_$AppDatabase db, $FieldRapItemsTable table)
    : super(
        TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$FieldRapItemsTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$FieldRapItemsTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$FieldRapItemsTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback:
              ({
                Value<String> userSub = const Value.absent(),
                Value<int> id = const Value.absent(),
                Value<int> companyId = const Value.absent(),
                Value<int> projectId = const Value.absent(),
                Value<String> code = const Value.absent(),
                Value<String> description = const Value.absent(),
                Value<String> kind = const Value.absent(),
                Value<String> uom = const Value.absent(),
                Value<String> stageName = const Value.absent(),
                Value<double> volume = const Value.absent(),
                Value<double> realised = const Value.absent(),
                Value<double> received = const Value.absent(),
                Value<double> used = const Value.absent(),
                Value<int> sortOrder = const Value.absent(),
                Value<bool> active = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => FieldRapItemsCompanion(
                userSub: userSub,
                id: id,
                companyId: companyId,
                projectId: projectId,
                code: code,
                description: description,
                kind: kind,
                uom: uom,
                stageName: stageName,
                volume: volume,
                realised: realised,
                received: received,
                used: used,
                sortOrder: sortOrder,
                active: active,
                rowid: rowid,
              ),
          createCompanionCallback:
              ({
                required String userSub,
                required int id,
                required int companyId,
                required int projectId,
                required String code,
                Value<String> description = const Value.absent(),
                required String kind,
                Value<String> uom = const Value.absent(),
                Value<String> stageName = const Value.absent(),
                Value<double> volume = const Value.absent(),
                Value<double> realised = const Value.absent(),
                Value<double> received = const Value.absent(),
                Value<double> used = const Value.absent(),
                Value<int> sortOrder = const Value.absent(),
                Value<bool> active = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => FieldRapItemsCompanion.insert(
                userSub: userSub,
                id: id,
                companyId: companyId,
                projectId: projectId,
                code: code,
                description: description,
                kind: kind,
                uom: uom,
                stageName: stageName,
                volume: volume,
                realised: realised,
                received: received,
                used: used,
                sortOrder: sortOrder,
                active: active,
                rowid: rowid,
              ),
          withReferenceMapper: (p0) => p0
              .map(
                (e) => (
                  e.readTable<$FieldRapItemsTable, FieldRapItemRow>(table),
                  BaseReferences<
                    _$AppDatabase,
                    $FieldRapItemsTable,
                    FieldRapItemRow
                  >(db, table, e),
                ),
              )
              .toList(),
          prefetchHooksCallback: null,
        ),
      );
}

typedef $$FieldRapItemsTableProcessedTableManager =
    ProcessedTableManager<
      _$AppDatabase,
      $FieldRapItemsTable,
      FieldRapItemRow,
      $$FieldRapItemsTableFilterComposer,
      $$FieldRapItemsTableOrderingComposer,
      $$FieldRapItemsTableAnnotationComposer,
      $$FieldRapItemsTableCreateCompanionBuilder,
      $$FieldRapItemsTableUpdateCompanionBuilder,
      (
        FieldRapItemRow,
        BaseReferences<_$AppDatabase, $FieldRapItemsTable, FieldRapItemRow>,
      ),
      FieldRapItemRow,
      PrefetchHooks Function()
    >;
typedef $$FieldResourceTypesTableCreateCompanionBuilder =
    FieldResourceTypesCompanion Function({
      required String userSub,
      required int id,
      required int companyId,
      required String kind,
      Value<String> code,
      Value<String> name,
      Value<int> rowid,
    });
typedef $$FieldResourceTypesTableUpdateCompanionBuilder =
    FieldResourceTypesCompanion Function({
      Value<String> userSub,
      Value<int> id,
      Value<int> companyId,
      Value<String> kind,
      Value<String> code,
      Value<String> name,
      Value<int> rowid,
    });

class $$FieldResourceTypesTableFilterComposer
    extends Composer<_$AppDatabase, $FieldResourceTypesTable> {
  $$FieldResourceTypesTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get userSub => $composableBuilder(
    column: $table.userSub,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get id => $composableBuilder(
    column: $table.id,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get companyId => $composableBuilder(
    column: $table.companyId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get kind => $composableBuilder(
    column: $table.kind,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get code => $composableBuilder(
    column: $table.code,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get name => $composableBuilder(
    column: $table.name,
    builder: (column) => ColumnFilters(column),
  );
}

class $$FieldResourceTypesTableOrderingComposer
    extends Composer<_$AppDatabase, $FieldResourceTypesTable> {
  $$FieldResourceTypesTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get userSub => $composableBuilder(
    column: $table.userSub,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get id => $composableBuilder(
    column: $table.id,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get companyId => $composableBuilder(
    column: $table.companyId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get kind => $composableBuilder(
    column: $table.kind,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get code => $composableBuilder(
    column: $table.code,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get name => $composableBuilder(
    column: $table.name,
    builder: (column) => ColumnOrderings(column),
  );
}

class $$FieldResourceTypesTableAnnotationComposer
    extends Composer<_$AppDatabase, $FieldResourceTypesTable> {
  $$FieldResourceTypesTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get userSub =>
      $composableBuilder(column: $table.userSub, builder: (column) => column);

  GeneratedColumn<int> get id =>
      $composableBuilder(column: $table.id, builder: (column) => column);

  GeneratedColumn<int> get companyId =>
      $composableBuilder(column: $table.companyId, builder: (column) => column);

  GeneratedColumn<String> get kind =>
      $composableBuilder(column: $table.kind, builder: (column) => column);

  GeneratedColumn<String> get code =>
      $composableBuilder(column: $table.code, builder: (column) => column);

  GeneratedColumn<String> get name =>
      $composableBuilder(column: $table.name, builder: (column) => column);
}

class $$FieldResourceTypesTableTableManager
    extends
        RootTableManager<
          _$AppDatabase,
          $FieldResourceTypesTable,
          FieldResourceTypeRow,
          $$FieldResourceTypesTableFilterComposer,
          $$FieldResourceTypesTableOrderingComposer,
          $$FieldResourceTypesTableAnnotationComposer,
          $$FieldResourceTypesTableCreateCompanionBuilder,
          $$FieldResourceTypesTableUpdateCompanionBuilder,
          (
            FieldResourceTypeRow,
            BaseReferences<
              _$AppDatabase,
              $FieldResourceTypesTable,
              FieldResourceTypeRow
            >,
          ),
          FieldResourceTypeRow,
          PrefetchHooks Function()
        > {
  $$FieldResourceTypesTableTableManager(
    _$AppDatabase db,
    $FieldResourceTypesTable table,
  ) : super(
        TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$FieldResourceTypesTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$FieldResourceTypesTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$FieldResourceTypesTableAnnotationComposer(
                $db: db,
                $table: table,
              ),
          updateCompanionCallback:
              ({
                Value<String> userSub = const Value.absent(),
                Value<int> id = const Value.absent(),
                Value<int> companyId = const Value.absent(),
                Value<String> kind = const Value.absent(),
                Value<String> code = const Value.absent(),
                Value<String> name = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => FieldResourceTypesCompanion(
                userSub: userSub,
                id: id,
                companyId: companyId,
                kind: kind,
                code: code,
                name: name,
                rowid: rowid,
              ),
          createCompanionCallback:
              ({
                required String userSub,
                required int id,
                required int companyId,
                required String kind,
                Value<String> code = const Value.absent(),
                Value<String> name = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => FieldResourceTypesCompanion.insert(
                userSub: userSub,
                id: id,
                companyId: companyId,
                kind: kind,
                code: code,
                name: name,
                rowid: rowid,
              ),
          withReferenceMapper: (p0) => p0
              .map(
                (e) => (
                  e.readTable<$FieldResourceTypesTable, FieldResourceTypeRow>(
                    table,
                  ),
                  BaseReferences<
                    _$AppDatabase,
                    $FieldResourceTypesTable,
                    FieldResourceTypeRow
                  >(db, table, e),
                ),
              )
              .toList(),
          prefetchHooksCallback: null,
        ),
      );
}

typedef $$FieldResourceTypesTableProcessedTableManager =
    ProcessedTableManager<
      _$AppDatabase,
      $FieldResourceTypesTable,
      FieldResourceTypeRow,
      $$FieldResourceTypesTableFilterComposer,
      $$FieldResourceTypesTableOrderingComposer,
      $$FieldResourceTypesTableAnnotationComposer,
      $$FieldResourceTypesTableCreateCompanionBuilder,
      $$FieldResourceTypesTableUpdateCompanionBuilder,
      (
        FieldResourceTypeRow,
        BaseReferences<
          _$AppDatabase,
          $FieldResourceTypesTable,
          FieldResourceTypeRow
        >,
      ),
      FieldResourceTypeRow,
      PrefetchHooks Function()
    >;
typedef $$FieldServiceTypesTableCreateCompanionBuilder =
    FieldServiceTypesCompanion Function({
      required String userSub,
      required int id,
      required int companyId,
      Value<String> code,
      Value<String> name,
      Value<bool> active,
      Value<int> sortOrder,
      Value<int> rowid,
    });
typedef $$FieldServiceTypesTableUpdateCompanionBuilder =
    FieldServiceTypesCompanion Function({
      Value<String> userSub,
      Value<int> id,
      Value<int> companyId,
      Value<String> code,
      Value<String> name,
      Value<bool> active,
      Value<int> sortOrder,
      Value<int> rowid,
    });

class $$FieldServiceTypesTableFilterComposer
    extends Composer<_$AppDatabase, $FieldServiceTypesTable> {
  $$FieldServiceTypesTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get userSub => $composableBuilder(
    column: $table.userSub,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get id => $composableBuilder(
    column: $table.id,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get companyId => $composableBuilder(
    column: $table.companyId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get code => $composableBuilder(
    column: $table.code,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get name => $composableBuilder(
    column: $table.name,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<bool> get active => $composableBuilder(
    column: $table.active,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get sortOrder => $composableBuilder(
    column: $table.sortOrder,
    builder: (column) => ColumnFilters(column),
  );
}

class $$FieldServiceTypesTableOrderingComposer
    extends Composer<_$AppDatabase, $FieldServiceTypesTable> {
  $$FieldServiceTypesTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get userSub => $composableBuilder(
    column: $table.userSub,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get id => $composableBuilder(
    column: $table.id,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get companyId => $composableBuilder(
    column: $table.companyId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get code => $composableBuilder(
    column: $table.code,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get name => $composableBuilder(
    column: $table.name,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<bool> get active => $composableBuilder(
    column: $table.active,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get sortOrder => $composableBuilder(
    column: $table.sortOrder,
    builder: (column) => ColumnOrderings(column),
  );
}

class $$FieldServiceTypesTableAnnotationComposer
    extends Composer<_$AppDatabase, $FieldServiceTypesTable> {
  $$FieldServiceTypesTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get userSub =>
      $composableBuilder(column: $table.userSub, builder: (column) => column);

  GeneratedColumn<int> get id =>
      $composableBuilder(column: $table.id, builder: (column) => column);

  GeneratedColumn<int> get companyId =>
      $composableBuilder(column: $table.companyId, builder: (column) => column);

  GeneratedColumn<String> get code =>
      $composableBuilder(column: $table.code, builder: (column) => column);

  GeneratedColumn<String> get name =>
      $composableBuilder(column: $table.name, builder: (column) => column);

  GeneratedColumn<bool> get active =>
      $composableBuilder(column: $table.active, builder: (column) => column);

  GeneratedColumn<int> get sortOrder =>
      $composableBuilder(column: $table.sortOrder, builder: (column) => column);
}

class $$FieldServiceTypesTableTableManager
    extends
        RootTableManager<
          _$AppDatabase,
          $FieldServiceTypesTable,
          FieldServiceTypeRow,
          $$FieldServiceTypesTableFilterComposer,
          $$FieldServiceTypesTableOrderingComposer,
          $$FieldServiceTypesTableAnnotationComposer,
          $$FieldServiceTypesTableCreateCompanionBuilder,
          $$FieldServiceTypesTableUpdateCompanionBuilder,
          (
            FieldServiceTypeRow,
            BaseReferences<
              _$AppDatabase,
              $FieldServiceTypesTable,
              FieldServiceTypeRow
            >,
          ),
          FieldServiceTypeRow,
          PrefetchHooks Function()
        > {
  $$FieldServiceTypesTableTableManager(
    _$AppDatabase db,
    $FieldServiceTypesTable table,
  ) : super(
        TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$FieldServiceTypesTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$FieldServiceTypesTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$FieldServiceTypesTableAnnotationComposer(
                $db: db,
                $table: table,
              ),
          updateCompanionCallback:
              ({
                Value<String> userSub = const Value.absent(),
                Value<int> id = const Value.absent(),
                Value<int> companyId = const Value.absent(),
                Value<String> code = const Value.absent(),
                Value<String> name = const Value.absent(),
                Value<bool> active = const Value.absent(),
                Value<int> sortOrder = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => FieldServiceTypesCompanion(
                userSub: userSub,
                id: id,
                companyId: companyId,
                code: code,
                name: name,
                active: active,
                sortOrder: sortOrder,
                rowid: rowid,
              ),
          createCompanionCallback:
              ({
                required String userSub,
                required int id,
                required int companyId,
                Value<String> code = const Value.absent(),
                Value<String> name = const Value.absent(),
                Value<bool> active = const Value.absent(),
                Value<int> sortOrder = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => FieldServiceTypesCompanion.insert(
                userSub: userSub,
                id: id,
                companyId: companyId,
                code: code,
                name: name,
                active: active,
                sortOrder: sortOrder,
                rowid: rowid,
              ),
          withReferenceMapper: (p0) => p0
              .map(
                (e) => (
                  e.readTable<$FieldServiceTypesTable, FieldServiceTypeRow>(
                    table,
                  ),
                  BaseReferences<
                    _$AppDatabase,
                    $FieldServiceTypesTable,
                    FieldServiceTypeRow
                  >(db, table, e),
                ),
              )
              .toList(),
          prefetchHooksCallback: null,
        ),
      );
}

typedef $$FieldServiceTypesTableProcessedTableManager =
    ProcessedTableManager<
      _$AppDatabase,
      $FieldServiceTypesTable,
      FieldServiceTypeRow,
      $$FieldServiceTypesTableFilterComposer,
      $$FieldServiceTypesTableOrderingComposer,
      $$FieldServiceTypesTableAnnotationComposer,
      $$FieldServiceTypesTableCreateCompanionBuilder,
      $$FieldServiceTypesTableUpdateCompanionBuilder,
      (
        FieldServiceTypeRow,
        BaseReferences<
          _$AppDatabase,
          $FieldServiceTypesTable,
          FieldServiceTypeRow
        >,
      ),
      FieldServiceTypeRow,
      PrefetchHooks Function()
    >;

class $AppDatabaseManager {
  final _$AppDatabase _db;
  $AppDatabaseManager(this._db);
  $$LocalDraftsTableTableManager get localDrafts =>
      $$LocalDraftsTableTableManager(_db, _db.localDrafts);
  $$LocalLinesTableTableManager get localLines =>
      $$LocalLinesTableTableManager(_db, _db.localLines);
  $$LocalReceiptsTableTableManager get localReceipts =>
      $$LocalReceiptsTableTableManager(_db, _db.localReceipts);
  $$MediaBlobsTableTableManager get mediaBlobs =>
      $$MediaBlobsTableTableManager(_db, _db.mediaBlobs);
  $$OutboxTableTableManager get outbox =>
      $$OutboxTableTableManager(_db, _db.outbox);
  $$KvEntriesTableTableManager get kvEntries =>
      $$KvEntriesTableTableManager(_db, _db.kvEntries);
  $$LocalProgressReportsTableTableManager get localProgressReports =>
      $$LocalProgressReportsTableTableManager(_db, _db.localProgressReports);
  $$LocalFieldReportsTableTableManager get localFieldReports =>
      $$LocalFieldReportsTableTableManager(_db, _db.localFieldReports);
  $$FieldUnitsTableTableManager get fieldUnits =>
      $$FieldUnitsTableTableManager(_db, _db.fieldUnits);
  $$FieldContractUnitsTableTableManager get fieldContractUnits =>
      $$FieldContractUnitsTableTableManager(_db, _db.fieldContractUnits);
  $$FieldOpenPosTableTableManager get fieldOpenPos =>
      $$FieldOpenPosTableTableManager(_db, _db.fieldOpenPos);
  $$FieldClientsTableTableManager get fieldClients =>
      $$FieldClientsTableTableManager(_db, _db.fieldClients);
  $$FieldRecentTimesheetsTableTableManager get fieldRecentTimesheets =>
      $$FieldRecentTimesheetsTableTableManager(_db, _db.fieldRecentTimesheets);
  $$FieldRapItemsTableTableManager get fieldRapItems =>
      $$FieldRapItemsTableTableManager(_db, _db.fieldRapItems);
  $$FieldResourceTypesTableTableManager get fieldResourceTypes =>
      $$FieldResourceTypesTableTableManager(_db, _db.fieldResourceTypes);
  $$FieldServiceTypesTableTableManager get fieldServiceTypes =>
      $$FieldServiceTypesTableTableManager(_db, _db.fieldServiceTypes);
}
