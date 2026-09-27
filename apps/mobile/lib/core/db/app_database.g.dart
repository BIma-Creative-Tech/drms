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
    type,
    title,
    projectId,
    costCenterId,
    neededDate,
    notes,
    requesterIdsJson,
    bankAccountId,
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
  final String type;
  final String title;
  final int? projectId;
  final int? costCenterId;
  final String? neededDate;
  final String? notes;
  final String requesterIdsJson;
  final int? bankAccountId;
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
    required this.type,
    required this.title,
    this.projectId,
    this.costCenterId,
    this.neededDate,
    this.notes,
    required this.requesterIdsJson,
    this.bankAccountId,
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
    if (!nullToAbsent || notes != null) {
      map['notes'] = Variable<String>(notes);
    }
    map['requester_ids_json'] = Variable<String>(requesterIdsJson);
    if (!nullToAbsent || bankAccountId != null) {
      map['bank_account_id'] = Variable<int>(bankAccountId);
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
      notes: notes == null && nullToAbsent
          ? const Value.absent()
          : Value(notes),
      requesterIdsJson: Value(requesterIdsJson),
      bankAccountId: bankAccountId == null && nullToAbsent
          ? const Value.absent()
          : Value(bankAccountId),
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
      type: serializer.fromJson<String>(json['type']),
      title: serializer.fromJson<String>(json['title']),
      projectId: serializer.fromJson<int?>(json['projectId']),
      costCenterId: serializer.fromJson<int?>(json['costCenterId']),
      neededDate: serializer.fromJson<String?>(json['neededDate']),
      notes: serializer.fromJson<String?>(json['notes']),
      requesterIdsJson: serializer.fromJson<String>(json['requesterIdsJson']),
      bankAccountId: serializer.fromJson<int?>(json['bankAccountId']),
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
      'type': serializer.toJson<String>(type),
      'title': serializer.toJson<String>(title),
      'projectId': serializer.toJson<int?>(projectId),
      'costCenterId': serializer.toJson<int?>(costCenterId),
      'neededDate': serializer.toJson<String?>(neededDate),
      'notes': serializer.toJson<String?>(notes),
      'requesterIdsJson': serializer.toJson<String>(requesterIdsJson),
      'bankAccountId': serializer.toJson<int?>(bankAccountId),
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
    String? type,
    String? title,
    Value<int?> projectId = const Value.absent(),
    Value<int?> costCenterId = const Value.absent(),
    Value<String?> neededDate = const Value.absent(),
    Value<String?> notes = const Value.absent(),
    String? requesterIdsJson,
    Value<int?> bankAccountId = const Value.absent(),
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
    type: type ?? this.type,
    title: title ?? this.title,
    projectId: projectId.present ? projectId.value : this.projectId,
    costCenterId: costCenterId.present ? costCenterId.value : this.costCenterId,
    neededDate: neededDate.present ? neededDate.value : this.neededDate,
    notes: notes.present ? notes.value : this.notes,
    requesterIdsJson: requesterIdsJson ?? this.requesterIdsJson,
    bankAccountId: bankAccountId.present
        ? bankAccountId.value
        : this.bankAccountId,
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
      type: data.type.present ? data.type.value : this.type,
      title: data.title.present ? data.title.value : this.title,
      projectId: data.projectId.present ? data.projectId.value : this.projectId,
      costCenterId: data.costCenterId.present
          ? data.costCenterId.value
          : this.costCenterId,
      neededDate: data.neededDate.present
          ? data.neededDate.value
          : this.neededDate,
      notes: data.notes.present ? data.notes.value : this.notes,
      requesterIdsJson: data.requesterIdsJson.present
          ? data.requesterIdsJson.value
          : this.requesterIdsJson,
      bankAccountId: data.bankAccountId.present
          ? data.bankAccountId.value
          : this.bankAccountId,
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
          ..write('type: $type, ')
          ..write('title: $title, ')
          ..write('projectId: $projectId, ')
          ..write('costCenterId: $costCenterId, ')
          ..write('neededDate: $neededDate, ')
          ..write('notes: $notes, ')
          ..write('requesterIdsJson: $requesterIdsJson, ')
          ..write('bankAccountId: $bankAccountId, ')
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
  int get hashCode => Object.hash(
    clientUuid,
    userSub,
    type,
    title,
    projectId,
    costCenterId,
    neededDate,
    notes,
    requesterIdsJson,
    bankAccountId,
    serverId,
    serverRev,
    syncState,
    lastError,
    conflictCopyJson,
    deleted,
    createdAt,
    updatedAt,
  );
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is LocalDraft &&
          other.clientUuid == this.clientUuid &&
          other.userSub == this.userSub &&
          other.type == this.type &&
          other.title == this.title &&
          other.projectId == this.projectId &&
          other.costCenterId == this.costCenterId &&
          other.neededDate == this.neededDate &&
          other.notes == this.notes &&
          other.requesterIdsJson == this.requesterIdsJson &&
          other.bankAccountId == this.bankAccountId &&
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
  final Value<String> type;
  final Value<String> title;
  final Value<int?> projectId;
  final Value<int?> costCenterId;
  final Value<String?> neededDate;
  final Value<String?> notes;
  final Value<String> requesterIdsJson;
  final Value<int?> bankAccountId;
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
    this.type = const Value.absent(),
    this.title = const Value.absent(),
    this.projectId = const Value.absent(),
    this.costCenterId = const Value.absent(),
    this.neededDate = const Value.absent(),
    this.notes = const Value.absent(),
    this.requesterIdsJson = const Value.absent(),
    this.bankAccountId = const Value.absent(),
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
    required String type,
    this.title = const Value.absent(),
    this.projectId = const Value.absent(),
    this.costCenterId = const Value.absent(),
    this.neededDate = const Value.absent(),
    this.notes = const Value.absent(),
    this.requesterIdsJson = const Value.absent(),
    this.bankAccountId = const Value.absent(),
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
    Expression<String>? type,
    Expression<String>? title,
    Expression<int>? projectId,
    Expression<int>? costCenterId,
    Expression<String>? neededDate,
    Expression<String>? notes,
    Expression<String>? requesterIdsJson,
    Expression<int>? bankAccountId,
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
      if (type != null) 'type': type,
      if (title != null) 'title': title,
      if (projectId != null) 'project_id': projectId,
      if (costCenterId != null) 'cost_center_id': costCenterId,
      if (neededDate != null) 'needed_date': neededDate,
      if (notes != null) 'notes': notes,
      if (requesterIdsJson != null) 'requester_ids_json': requesterIdsJson,
      if (bankAccountId != null) 'bank_account_id': bankAccountId,
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
    Value<String>? type,
    Value<String>? title,
    Value<int?>? projectId,
    Value<int?>? costCenterId,
    Value<String?>? neededDate,
    Value<String?>? notes,
    Value<String>? requesterIdsJson,
    Value<int?>? bankAccountId,
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
      type: type ?? this.type,
      title: title ?? this.title,
      projectId: projectId ?? this.projectId,
      costCenterId: costCenterId ?? this.costCenterId,
      neededDate: neededDate ?? this.neededDate,
      notes: notes ?? this.notes,
      requesterIdsJson: requesterIdsJson ?? this.requesterIdsJson,
      bankAccountId: bankAccountId ?? this.bankAccountId,
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
    if (notes.present) {
      map['notes'] = Variable<String>(notes.value);
    }
    if (requesterIdsJson.present) {
      map['requester_ids_json'] = Variable<String>(requesterIdsJson.value);
    }
    if (bankAccountId.present) {
      map['bank_account_id'] = Variable<int>(bankAccountId.value);
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
          ..write('type: $type, ')
          ..write('title: $title, ')
          ..write('projectId: $projectId, ')
          ..write('costCenterId: $costCenterId, ')
          ..write('neededDate: $neededDate, ')
          ..write('notes: $notes, ')
          ..write('requesterIdsJson: $requesterIdsJson, ')
          ..write('bankAccountId: $bankAccountId, ')
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
  ];
}

typedef $$LocalDraftsTableCreateCompanionBuilder =
    LocalDraftsCompanion Function({
      required String clientUuid,
      required String userSub,
      required String type,
      Value<String> title,
      Value<int?> projectId,
      Value<int?> costCenterId,
      Value<String?> neededDate,
      Value<String?> notes,
      Value<String> requesterIdsJson,
      Value<int?> bankAccountId,
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
      Value<String> type,
      Value<String> title,
      Value<int?> projectId,
      Value<int?> costCenterId,
      Value<String?> neededDate,
      Value<String?> notes,
      Value<String> requesterIdsJson,
      Value<int?> bankAccountId,
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
                Value<String> type = const Value.absent(),
                Value<String> title = const Value.absent(),
                Value<int?> projectId = const Value.absent(),
                Value<int?> costCenterId = const Value.absent(),
                Value<String?> neededDate = const Value.absent(),
                Value<String?> notes = const Value.absent(),
                Value<String> requesterIdsJson = const Value.absent(),
                Value<int?> bankAccountId = const Value.absent(),
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
                type: type,
                title: title,
                projectId: projectId,
                costCenterId: costCenterId,
                neededDate: neededDate,
                notes: notes,
                requesterIdsJson: requesterIdsJson,
                bankAccountId: bankAccountId,
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
                required String type,
                Value<String> title = const Value.absent(),
                Value<int?> projectId = const Value.absent(),
                Value<int?> costCenterId = const Value.absent(),
                Value<String?> neededDate = const Value.absent(),
                Value<String?> notes = const Value.absent(),
                Value<String> requesterIdsJson = const Value.absent(),
                Value<int?> bankAccountId = const Value.absent(),
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
                type: type,
                title: title,
                projectId: projectId,
                costCenterId: costCenterId,
                neededDate: neededDate,
                notes: notes,
                requesterIdsJson: requesterIdsJson,
                bankAccountId: bankAccountId,
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
}
