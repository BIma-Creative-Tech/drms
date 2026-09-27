// GENERATED CODE - DO NOT MODIFY BY HAND
// coverage:ignore-file
// ignore_for_file: type=lint, type=warning, deprecated_member_use, deprecated_member_use_from_same_package
// ignore_for_file: unused_element, deprecated_member_use, deprecated_member_use_from_same_package, use_function_type_syntax_for_parameters, unnecessary_const, avoid_init_to_null, invalid_override_different_default_values_named, prefer_expression_function_bodies, annotate_overrides, invalid_annotation_target, unnecessary_question_mark

part of 'draft.dart';

// **************************************************************************
// FreezedGenerator
// **************************************************************************

// GENERATED CODE - DO NOT MODIFY BY HAND
// dart format off
T _$identity<T>(T value) => value;
/// @nodoc
mixin _$DraftReceipt {

 String get clientUuid; String? get receiptNo; String get vendorName; String get receiptDate; String? get receiptTime; int get amount; String get mediaUuid; int? get serverReceiptId;
/// Create a copy of DraftReceipt
/// with the given fields replaced by the non-null parameter values.
@JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$DraftReceiptCopyWith<DraftReceipt> get copyWith => _$DraftReceiptCopyWithImpl<DraftReceipt>(this as DraftReceipt, _$identity);



@override
bool operator ==(Object other) {
  final _this = this as DraftReceipt;
  return identical(this, other) || (other.runtimeType == runtimeType&&other is DraftReceipt&&(identical(other.clientUuid, _this.clientUuid) || other.clientUuid == _this.clientUuid)&&(identical(other.receiptNo, _this.receiptNo) || other.receiptNo == _this.receiptNo)&&(identical(other.vendorName, _this.vendorName) || other.vendorName == _this.vendorName)&&(identical(other.receiptDate, _this.receiptDate) || other.receiptDate == _this.receiptDate)&&(identical(other.receiptTime, _this.receiptTime) || other.receiptTime == _this.receiptTime)&&(identical(other.amount, _this.amount) || other.amount == _this.amount)&&(identical(other.mediaUuid, _this.mediaUuid) || other.mediaUuid == _this.mediaUuid)&&(identical(other.serverReceiptId, _this.serverReceiptId) || other.serverReceiptId == _this.serverReceiptId));
}


@override
int get hashCode {
  final _this = this as DraftReceipt;
  return Object.hash(runtimeType,_this.clientUuid,_this.receiptNo,_this.vendorName,_this.receiptDate,_this.receiptTime,_this.amount,_this.mediaUuid,_this.serverReceiptId);
}

@override
String toString() {
  final _this = this as DraftReceipt;
  return 'DraftReceipt(clientUuid: ${_this.clientUuid}, receiptNo: ${_this.receiptNo}, vendorName: ${_this.vendorName}, receiptDate: ${_this.receiptDate}, receiptTime: ${_this.receiptTime}, amount: ${_this.amount}, mediaUuid: ${_this.mediaUuid}, serverReceiptId: ${_this.serverReceiptId})';
}


}

/// @nodoc
abstract mixin class $DraftReceiptCopyWith<$Res>  {
  factory $DraftReceiptCopyWith(DraftReceipt value, $Res Function(DraftReceipt) _then) = _$DraftReceiptCopyWithImpl;
@useResult
$Res call({
 String clientUuid, String? receiptNo, String vendorName, String receiptDate, String? receiptTime, int amount, String mediaUuid, int? serverReceiptId
});




}
/// @nodoc
class _$DraftReceiptCopyWithImpl<$Res>
    implements $DraftReceiptCopyWith<$Res> {
  _$DraftReceiptCopyWithImpl(this._self, this._then);

  final DraftReceipt _self;
  final $Res Function(DraftReceipt) _then;

/// Create a copy of DraftReceipt
/// with the given fields replaced by the non-null parameter values.
@pragma('vm:prefer-inline') @override $Res call({Object? clientUuid = null,Object? receiptNo = freezed,Object? vendorName = null,Object? receiptDate = null,Object? receiptTime = freezed,Object? amount = null,Object? mediaUuid = null,Object? serverReceiptId = freezed,}) {
  return _then(DraftReceipt(
clientUuid: null == clientUuid ? _self.clientUuid : clientUuid // ignore: cast_nullable_to_non_nullable
as String,receiptNo: freezed == receiptNo ? _self.receiptNo : receiptNo // ignore: cast_nullable_to_non_nullable
as String?,vendorName: null == vendorName ? _self.vendorName : vendorName // ignore: cast_nullable_to_non_nullable
as String,receiptDate: null == receiptDate ? _self.receiptDate : receiptDate // ignore: cast_nullable_to_non_nullable
as String,receiptTime: freezed == receiptTime ? _self.receiptTime : receiptTime // ignore: cast_nullable_to_non_nullable
as String?,amount: null == amount ? _self.amount : amount // ignore: cast_nullable_to_non_nullable
as int,mediaUuid: null == mediaUuid ? _self.mediaUuid : mediaUuid // ignore: cast_nullable_to_non_nullable
as String,serverReceiptId: freezed == serverReceiptId ? _self.serverReceiptId : serverReceiptId // ignore: cast_nullable_to_non_nullable
as int?,
  ));
}

}


/// Adds pattern-matching-related methods to [DraftReceipt].
extension DraftReceiptPatterns on DraftReceipt {
/// A variant of `map` that fallback to returning `orElse`.
///
/// It is equivalent to doing:
/// ```dart
/// switch (sealedClass) {
///   case final Subclass value:
///     return ...;
///   case _:
///     return orElse();
/// }
/// ```

@optionalTypeArgs TResult maybeMap<TResult extends Object?>(TResult Function( _DraftReceipt value)?  $default,{required TResult orElse(),}){
final _that = this;
switch (_that) {
case _DraftReceipt() when $default != null:
return $default(_that);case _:
  return orElse();

}
}
/// A `switch`-like method, using callbacks.
///
/// Callbacks receives the raw object, upcasted.
/// It is equivalent to doing:
/// ```dart
/// switch (sealedClass) {
///   case final Subclass value:
///     return ...;
///   case final Subclass2 value:
///     return ...;
/// }
/// ```

@optionalTypeArgs TResult map<TResult extends Object?>(TResult Function( _DraftReceipt value)  $default,){
final _that = this;
switch (_that) {
case _DraftReceipt():
return $default(_that);case _:
  throw StateError('Unexpected subclass');

}
}
/// A variant of `map` that fallback to returning `null`.
///
/// It is equivalent to doing:
/// ```dart
/// switch (sealedClass) {
///   case final Subclass value:
///     return ...;
///   case _:
///     return null;
/// }
/// ```

@optionalTypeArgs TResult? mapOrNull<TResult extends Object?>(TResult? Function( _DraftReceipt value)?  $default,){
final _that = this;
switch (_that) {
case _DraftReceipt() when $default != null:
return $default(_that);case _:
  return null;

}
}
/// A variant of `when` that fallback to an `orElse` callback.
///
/// It is equivalent to doing:
/// ```dart
/// switch (sealedClass) {
///   case Subclass(:final field):
///     return ...;
///   case _:
///     return orElse();
/// }
/// ```

@optionalTypeArgs TResult maybeWhen<TResult extends Object?>(TResult Function( String clientUuid,  String? receiptNo,  String vendorName,  String receiptDate,  String? receiptTime,  int amount,  String mediaUuid,  int? serverReceiptId)?  $default,{required TResult orElse(),}) {final _that = this;
switch (_that) {
case _DraftReceipt() when $default != null:
return $default(_that.clientUuid,_that.receiptNo,_that.vendorName,_that.receiptDate,_that.receiptTime,_that.amount,_that.mediaUuid,_that.serverReceiptId);case _:
  return orElse();

}
}
/// A `switch`-like method, using callbacks.
///
/// As opposed to `map`, this offers destructuring.
/// It is equivalent to doing:
/// ```dart
/// switch (sealedClass) {
///   case Subclass(:final field):
///     return ...;
///   case Subclass2(:final field2):
///     return ...;
/// }
/// ```

@optionalTypeArgs TResult when<TResult extends Object?>(TResult Function( String clientUuid,  String? receiptNo,  String vendorName,  String receiptDate,  String? receiptTime,  int amount,  String mediaUuid,  int? serverReceiptId)  $default,) {final _that = this;
switch (_that) {
case _DraftReceipt():
return $default(_that.clientUuid,_that.receiptNo,_that.vendorName,_that.receiptDate,_that.receiptTime,_that.amount,_that.mediaUuid,_that.serverReceiptId);case _:
  throw StateError('Unexpected subclass');

}
}
/// A variant of `when` that fallback to returning `null`
///
/// It is equivalent to doing:
/// ```dart
/// switch (sealedClass) {
///   case Subclass(:final field):
///     return ...;
///   case _:
///     return null;
/// }
/// ```

@optionalTypeArgs TResult? whenOrNull<TResult extends Object?>(TResult? Function( String clientUuid,  String? receiptNo,  String vendorName,  String receiptDate,  String? receiptTime,  int amount,  String mediaUuid,  int? serverReceiptId)?  $default,) {final _that = this;
switch (_that) {
case _DraftReceipt() when $default != null:
return $default(_that.clientUuid,_that.receiptNo,_that.vendorName,_that.receiptDate,_that.receiptTime,_that.amount,_that.mediaUuid,_that.serverReceiptId);case _:
  return null;

}
}

}

/// @nodoc


class _DraftReceipt implements DraftReceipt {
  const _DraftReceipt({required this.clientUuid, this.receiptNo, required this.vendorName, required this.receiptDate, this.receiptTime, required this.amount, required this.mediaUuid, this.serverReceiptId});
  

@override final  String clientUuid;
@override final  String? receiptNo;
@override final  String vendorName;
@override final  String receiptDate;
@override final  String? receiptTime;
@override final  int amount;
@override final  String mediaUuid;
@override final  int? serverReceiptId;

/// Create a copy of DraftReceipt
/// with the given fields replaced by the non-null parameter values.
@override @JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
_$DraftReceiptCopyWith<_DraftReceipt> get copyWith => __$DraftReceiptCopyWithImpl<_DraftReceipt>(this, _$identity);



@override
bool operator ==(Object other) {
    return identical(this, other) || (other.runtimeType == runtimeType&&other is _DraftReceipt&&(identical(other.clientUuid, clientUuid) || other.clientUuid == clientUuid)&&(identical(other.receiptNo, receiptNo) || other.receiptNo == receiptNo)&&(identical(other.vendorName, vendorName) || other.vendorName == vendorName)&&(identical(other.receiptDate, receiptDate) || other.receiptDate == receiptDate)&&(identical(other.receiptTime, receiptTime) || other.receiptTime == receiptTime)&&(identical(other.amount, amount) || other.amount == amount)&&(identical(other.mediaUuid, mediaUuid) || other.mediaUuid == mediaUuid)&&(identical(other.serverReceiptId, serverReceiptId) || other.serverReceiptId == serverReceiptId));
}


@override
int get hashCode {
    return Object.hash(runtimeType,clientUuid,receiptNo,vendorName,receiptDate,receiptTime,amount,mediaUuid,serverReceiptId);
}

@override
String toString() {
    return 'DraftReceipt(clientUuid: $clientUuid, receiptNo: $receiptNo, vendorName: $vendorName, receiptDate: $receiptDate, receiptTime: $receiptTime, amount: $amount, mediaUuid: $mediaUuid, serverReceiptId: $serverReceiptId)';
}


}

/// @nodoc
abstract mixin class _$DraftReceiptCopyWith<$Res> implements $DraftReceiptCopyWith<$Res> {
  factory _$DraftReceiptCopyWith(_DraftReceipt value, $Res Function(_DraftReceipt) _then) = __$DraftReceiptCopyWithImpl;
@override @useResult
$Res call({
 String clientUuid, String? receiptNo, String vendorName, String receiptDate, String? receiptTime, int amount, String mediaUuid, int? serverReceiptId
});




}
/// @nodoc
class __$DraftReceiptCopyWithImpl<$Res>
    implements _$DraftReceiptCopyWith<$Res> {
  __$DraftReceiptCopyWithImpl(this._self, this._then);

  final _DraftReceipt _self;
  final $Res Function(_DraftReceipt) _then;

/// Create a copy of DraftReceipt
/// with the given fields replaced by the non-null parameter values.
@override @pragma('vm:prefer-inline') $Res call({Object? clientUuid = null,Object? receiptNo = freezed,Object? vendorName = null,Object? receiptDate = null,Object? receiptTime = freezed,Object? amount = null,Object? mediaUuid = null,Object? serverReceiptId = freezed,}) {
  return _then(_DraftReceipt(
clientUuid: null == clientUuid ? _self.clientUuid : clientUuid // ignore: cast_nullable_to_non_nullable
as String,receiptNo: freezed == receiptNo ? _self.receiptNo : receiptNo // ignore: cast_nullable_to_non_nullable
as String?,vendorName: null == vendorName ? _self.vendorName : vendorName // ignore: cast_nullable_to_non_nullable
as String,receiptDate: null == receiptDate ? _self.receiptDate : receiptDate // ignore: cast_nullable_to_non_nullable
as String,receiptTime: freezed == receiptTime ? _self.receiptTime : receiptTime // ignore: cast_nullable_to_non_nullable
as String?,amount: null == amount ? _self.amount : amount // ignore: cast_nullable_to_non_nullable
as int,mediaUuid: null == mediaUuid ? _self.mediaUuid : mediaUuid // ignore: cast_nullable_to_non_nullable
as String,serverReceiptId: freezed == serverReceiptId ? _self.serverReceiptId : serverReceiptId // ignore: cast_nullable_to_non_nullable
as int?,
  ));
}


}

/// @nodoc
mixin _$DraftLine {

 String get clientUuid; int get no; String get description; double? get qty; int? get uomId; int? get unitPrice; int? get total; int? get categoryId; int? get vehicleId; String? get notes; List<DraftReceipt> get receipts;
/// Create a copy of DraftLine
/// with the given fields replaced by the non-null parameter values.
@JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$DraftLineCopyWith<DraftLine> get copyWith => _$DraftLineCopyWithImpl<DraftLine>(this as DraftLine, _$identity);



@override
bool operator ==(Object other) {
  final _this = this as DraftLine;
  return identical(this, other) || (other.runtimeType == runtimeType&&other is DraftLine&&(identical(other.clientUuid, _this.clientUuid) || other.clientUuid == _this.clientUuid)&&(identical(other.no, _this.no) || other.no == _this.no)&&(identical(other.description, _this.description) || other.description == _this.description)&&(identical(other.qty, _this.qty) || other.qty == _this.qty)&&(identical(other.uomId, _this.uomId) || other.uomId == _this.uomId)&&(identical(other.unitPrice, _this.unitPrice) || other.unitPrice == _this.unitPrice)&&(identical(other.total, _this.total) || other.total == _this.total)&&(identical(other.categoryId, _this.categoryId) || other.categoryId == _this.categoryId)&&(identical(other.vehicleId, _this.vehicleId) || other.vehicleId == _this.vehicleId)&&(identical(other.notes, _this.notes) || other.notes == _this.notes)&&const DeepCollectionEquality().equals(other.receipts, _this.receipts));
}


@override
int get hashCode {
  final _this = this as DraftLine;
  return Object.hash(runtimeType,_this.clientUuid,_this.no,_this.description,_this.qty,_this.uomId,_this.unitPrice,_this.total,_this.categoryId,_this.vehicleId,_this.notes,const DeepCollectionEquality().hash(_this.receipts));
}

@override
String toString() {
  final _this = this as DraftLine;
  return 'DraftLine(clientUuid: ${_this.clientUuid}, no: ${_this.no}, description: ${_this.description}, qty: ${_this.qty}, uomId: ${_this.uomId}, unitPrice: ${_this.unitPrice}, total: ${_this.total}, categoryId: ${_this.categoryId}, vehicleId: ${_this.vehicleId}, notes: ${_this.notes}, receipts: ${_this.receipts})';
}


}

/// @nodoc
abstract mixin class $DraftLineCopyWith<$Res>  {
  factory $DraftLineCopyWith(DraftLine value, $Res Function(DraftLine) _then) = _$DraftLineCopyWithImpl;
@useResult
$Res call({
 String clientUuid, int no, String description, double? qty, int? uomId, int? unitPrice, int? total, int? categoryId, int? vehicleId, String? notes, List<DraftReceipt> receipts
});




}
/// @nodoc
class _$DraftLineCopyWithImpl<$Res>
    implements $DraftLineCopyWith<$Res> {
  _$DraftLineCopyWithImpl(this._self, this._then);

  final DraftLine _self;
  final $Res Function(DraftLine) _then;

/// Create a copy of DraftLine
/// with the given fields replaced by the non-null parameter values.
@pragma('vm:prefer-inline') @override $Res call({Object? clientUuid = null,Object? no = null,Object? description = null,Object? qty = freezed,Object? uomId = freezed,Object? unitPrice = freezed,Object? total = freezed,Object? categoryId = freezed,Object? vehicleId = freezed,Object? notes = freezed,Object? receipts = null,}) {
  return _then(DraftLine(
clientUuid: null == clientUuid ? _self.clientUuid : clientUuid // ignore: cast_nullable_to_non_nullable
as String,no: null == no ? _self.no : no // ignore: cast_nullable_to_non_nullable
as int,description: null == description ? _self.description : description // ignore: cast_nullable_to_non_nullable
as String,qty: freezed == qty ? _self.qty : qty // ignore: cast_nullable_to_non_nullable
as double?,uomId: freezed == uomId ? _self.uomId : uomId // ignore: cast_nullable_to_non_nullable
as int?,unitPrice: freezed == unitPrice ? _self.unitPrice : unitPrice // ignore: cast_nullable_to_non_nullable
as int?,total: freezed == total ? _self.total : total // ignore: cast_nullable_to_non_nullable
as int?,categoryId: freezed == categoryId ? _self.categoryId : categoryId // ignore: cast_nullable_to_non_nullable
as int?,vehicleId: freezed == vehicleId ? _self.vehicleId : vehicleId // ignore: cast_nullable_to_non_nullable
as int?,notes: freezed == notes ? _self.notes : notes // ignore: cast_nullable_to_non_nullable
as String?,receipts: null == receipts ? _self.receipts : receipts // ignore: cast_nullable_to_non_nullable
as List<DraftReceipt>,
  ));
}

}


/// Adds pattern-matching-related methods to [DraftLine].
extension DraftLinePatterns on DraftLine {
/// A variant of `map` that fallback to returning `orElse`.
///
/// It is equivalent to doing:
/// ```dart
/// switch (sealedClass) {
///   case final Subclass value:
///     return ...;
///   case _:
///     return orElse();
/// }
/// ```

@optionalTypeArgs TResult maybeMap<TResult extends Object?>(TResult Function( _DraftLine value)?  $default,{required TResult orElse(),}){
final _that = this;
switch (_that) {
case _DraftLine() when $default != null:
return $default(_that);case _:
  return orElse();

}
}
/// A `switch`-like method, using callbacks.
///
/// Callbacks receives the raw object, upcasted.
/// It is equivalent to doing:
/// ```dart
/// switch (sealedClass) {
///   case final Subclass value:
///     return ...;
///   case final Subclass2 value:
///     return ...;
/// }
/// ```

@optionalTypeArgs TResult map<TResult extends Object?>(TResult Function( _DraftLine value)  $default,){
final _that = this;
switch (_that) {
case _DraftLine():
return $default(_that);case _:
  throw StateError('Unexpected subclass');

}
}
/// A variant of `map` that fallback to returning `null`.
///
/// It is equivalent to doing:
/// ```dart
/// switch (sealedClass) {
///   case final Subclass value:
///     return ...;
///   case _:
///     return null;
/// }
/// ```

@optionalTypeArgs TResult? mapOrNull<TResult extends Object?>(TResult? Function( _DraftLine value)?  $default,){
final _that = this;
switch (_that) {
case _DraftLine() when $default != null:
return $default(_that);case _:
  return null;

}
}
/// A variant of `when` that fallback to an `orElse` callback.
///
/// It is equivalent to doing:
/// ```dart
/// switch (sealedClass) {
///   case Subclass(:final field):
///     return ...;
///   case _:
///     return orElse();
/// }
/// ```

@optionalTypeArgs TResult maybeWhen<TResult extends Object?>(TResult Function( String clientUuid,  int no,  String description,  double? qty,  int? uomId,  int? unitPrice,  int? total,  int? categoryId,  int? vehicleId,  String? notes,  List<DraftReceipt> receipts)?  $default,{required TResult orElse(),}) {final _that = this;
switch (_that) {
case _DraftLine() when $default != null:
return $default(_that.clientUuid,_that.no,_that.description,_that.qty,_that.uomId,_that.unitPrice,_that.total,_that.categoryId,_that.vehicleId,_that.notes,_that.receipts);case _:
  return orElse();

}
}
/// A `switch`-like method, using callbacks.
///
/// As opposed to `map`, this offers destructuring.
/// It is equivalent to doing:
/// ```dart
/// switch (sealedClass) {
///   case Subclass(:final field):
///     return ...;
///   case Subclass2(:final field2):
///     return ...;
/// }
/// ```

@optionalTypeArgs TResult when<TResult extends Object?>(TResult Function( String clientUuid,  int no,  String description,  double? qty,  int? uomId,  int? unitPrice,  int? total,  int? categoryId,  int? vehicleId,  String? notes,  List<DraftReceipt> receipts)  $default,) {final _that = this;
switch (_that) {
case _DraftLine():
return $default(_that.clientUuid,_that.no,_that.description,_that.qty,_that.uomId,_that.unitPrice,_that.total,_that.categoryId,_that.vehicleId,_that.notes,_that.receipts);case _:
  throw StateError('Unexpected subclass');

}
}
/// A variant of `when` that fallback to returning `null`
///
/// It is equivalent to doing:
/// ```dart
/// switch (sealedClass) {
///   case Subclass(:final field):
///     return ...;
///   case _:
///     return null;
/// }
/// ```

@optionalTypeArgs TResult? whenOrNull<TResult extends Object?>(TResult? Function( String clientUuid,  int no,  String description,  double? qty,  int? uomId,  int? unitPrice,  int? total,  int? categoryId,  int? vehicleId,  String? notes,  List<DraftReceipt> receipts)?  $default,) {final _that = this;
switch (_that) {
case _DraftLine() when $default != null:
return $default(_that.clientUuid,_that.no,_that.description,_that.qty,_that.uomId,_that.unitPrice,_that.total,_that.categoryId,_that.vehicleId,_that.notes,_that.receipts);case _:
  return null;

}
}

}

/// @nodoc


class _DraftLine implements DraftLine {
  const _DraftLine({required this.clientUuid, required this.no, this.description = '', this.qty, this.uomId, this.unitPrice, this.total, this.categoryId, this.vehicleId, this.notes,  List<DraftReceipt> receipts = const []}): _receipts = receipts;
  

@override final  String clientUuid;
@override final  int no;
@override@JsonKey() final  String description;
@override final  double? qty;
@override final  int? uomId;
@override final  int? unitPrice;
@override final  int? total;
@override final  int? categoryId;
@override final  int? vehicleId;
@override final  String? notes;
 final  List<DraftReceipt> _receipts;
@override@JsonKey() List<DraftReceipt> get receipts {
  if (_receipts is EqualUnmodifiableListView) return _receipts;
  // ignore: implicit_dynamic_type
  return EqualUnmodifiableListView(_receipts);
}


/// Create a copy of DraftLine
/// with the given fields replaced by the non-null parameter values.
@override @JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
_$DraftLineCopyWith<_DraftLine> get copyWith => __$DraftLineCopyWithImpl<_DraftLine>(this, _$identity);



@override
bool operator ==(Object other) {
    return identical(this, other) || (other.runtimeType == runtimeType&&other is _DraftLine&&(identical(other.clientUuid, clientUuid) || other.clientUuid == clientUuid)&&(identical(other.no, no) || other.no == no)&&(identical(other.description, description) || other.description == description)&&(identical(other.qty, qty) || other.qty == qty)&&(identical(other.uomId, uomId) || other.uomId == uomId)&&(identical(other.unitPrice, unitPrice) || other.unitPrice == unitPrice)&&(identical(other.total, total) || other.total == total)&&(identical(other.categoryId, categoryId) || other.categoryId == categoryId)&&(identical(other.vehicleId, vehicleId) || other.vehicleId == vehicleId)&&(identical(other.notes, notes) || other.notes == notes)&&const DeepCollectionEquality().equals(other.receipts, _receipts));
}


@override
int get hashCode {
    return Object.hash(runtimeType,clientUuid,no,description,qty,uomId,unitPrice,total,categoryId,vehicleId,notes,const DeepCollectionEquality().hash(_receipts));
}

@override
String toString() {
    return 'DraftLine(clientUuid: $clientUuid, no: $no, description: $description, qty: $qty, uomId: $uomId, unitPrice: $unitPrice, total: $total, categoryId: $categoryId, vehicleId: $vehicleId, notes: $notes, receipts: $receipts)';
}


}

/// @nodoc
abstract mixin class _$DraftLineCopyWith<$Res> implements $DraftLineCopyWith<$Res> {
  factory _$DraftLineCopyWith(_DraftLine value, $Res Function(_DraftLine) _then) = __$DraftLineCopyWithImpl;
@override @useResult
$Res call({
 String clientUuid, int no, String description, double? qty, int? uomId, int? unitPrice, int? total, int? categoryId, int? vehicleId, String? notes, List<DraftReceipt> receipts
});




}
/// @nodoc
class __$DraftLineCopyWithImpl<$Res>
    implements _$DraftLineCopyWith<$Res> {
  __$DraftLineCopyWithImpl(this._self, this._then);

  final _DraftLine _self;
  final $Res Function(_DraftLine) _then;

/// Create a copy of DraftLine
/// with the given fields replaced by the non-null parameter values.
@override @pragma('vm:prefer-inline') $Res call({Object? clientUuid = null,Object? no = null,Object? description = null,Object? qty = freezed,Object? uomId = freezed,Object? unitPrice = freezed,Object? total = freezed,Object? categoryId = freezed,Object? vehicleId = freezed,Object? notes = freezed,Object? receipts = null,}) {
  return _then(_DraftLine(
clientUuid: null == clientUuid ? _self.clientUuid : clientUuid // ignore: cast_nullable_to_non_nullable
as String,no: null == no ? _self.no : no // ignore: cast_nullable_to_non_nullable
as int,description: null == description ? _self.description : description // ignore: cast_nullable_to_non_nullable
as String,qty: freezed == qty ? _self.qty : qty // ignore: cast_nullable_to_non_nullable
as double?,uomId: freezed == uomId ? _self.uomId : uomId // ignore: cast_nullable_to_non_nullable
as int?,unitPrice: freezed == unitPrice ? _self.unitPrice : unitPrice // ignore: cast_nullable_to_non_nullable
as int?,total: freezed == total ? _self.total : total // ignore: cast_nullable_to_non_nullable
as int?,categoryId: freezed == categoryId ? _self.categoryId : categoryId // ignore: cast_nullable_to_non_nullable
as int?,vehicleId: freezed == vehicleId ? _self.vehicleId : vehicleId // ignore: cast_nullable_to_non_nullable
as int?,notes: freezed == notes ? _self.notes : notes // ignore: cast_nullable_to_non_nullable
as String?,receipts: null == receipts ? _self._receipts : receipts // ignore: cast_nullable_to_non_nullable
as List<DraftReceipt>,
  ));
}


}

/// @nodoc
mixin _$DraftRequest {

 String get clientUuid; RequestType get type; String get title; int? get projectId; int? get costCenterId; String? get neededDate; String? get notes; List<int> get requesterIds; int? get bankAccountId; List<DraftLine> get lines; int? get serverId; int? get serverRev; DraftSyncState get syncState; String? get lastError; DateTime? get updatedAt;
/// Create a copy of DraftRequest
/// with the given fields replaced by the non-null parameter values.
@JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$DraftRequestCopyWith<DraftRequest> get copyWith => _$DraftRequestCopyWithImpl<DraftRequest>(this as DraftRequest, _$identity);



@override
bool operator ==(Object other) {
  final _this = this as DraftRequest;
  return identical(this, other) || (other.runtimeType == runtimeType&&other is DraftRequest&&(identical(other.clientUuid, _this.clientUuid) || other.clientUuid == _this.clientUuid)&&(identical(other.type, _this.type) || other.type == _this.type)&&(identical(other.title, _this.title) || other.title == _this.title)&&(identical(other.projectId, _this.projectId) || other.projectId == _this.projectId)&&(identical(other.costCenterId, _this.costCenterId) || other.costCenterId == _this.costCenterId)&&(identical(other.neededDate, _this.neededDate) || other.neededDate == _this.neededDate)&&(identical(other.notes, _this.notes) || other.notes == _this.notes)&&const DeepCollectionEquality().equals(other.requesterIds, _this.requesterIds)&&(identical(other.bankAccountId, _this.bankAccountId) || other.bankAccountId == _this.bankAccountId)&&const DeepCollectionEquality().equals(other.lines, _this.lines)&&(identical(other.serverId, _this.serverId) || other.serverId == _this.serverId)&&(identical(other.serverRev, _this.serverRev) || other.serverRev == _this.serverRev)&&(identical(other.syncState, _this.syncState) || other.syncState == _this.syncState)&&(identical(other.lastError, _this.lastError) || other.lastError == _this.lastError)&&(identical(other.updatedAt, _this.updatedAt) || other.updatedAt == _this.updatedAt));
}


@override
int get hashCode {
  final _this = this as DraftRequest;
  return Object.hash(runtimeType,_this.clientUuid,_this.type,_this.title,_this.projectId,_this.costCenterId,_this.neededDate,_this.notes,const DeepCollectionEquality().hash(_this.requesterIds),_this.bankAccountId,const DeepCollectionEquality().hash(_this.lines),_this.serverId,_this.serverRev,_this.syncState,_this.lastError,_this.updatedAt);
}

@override
String toString() {
  final _this = this as DraftRequest;
  return 'DraftRequest(clientUuid: ${_this.clientUuid}, type: ${_this.type}, title: ${_this.title}, projectId: ${_this.projectId}, costCenterId: ${_this.costCenterId}, neededDate: ${_this.neededDate}, notes: ${_this.notes}, requesterIds: ${_this.requesterIds}, bankAccountId: ${_this.bankAccountId}, lines: ${_this.lines}, serverId: ${_this.serverId}, serverRev: ${_this.serverRev}, syncState: ${_this.syncState}, lastError: ${_this.lastError}, updatedAt: ${_this.updatedAt})';
}


}

/// @nodoc
abstract mixin class $DraftRequestCopyWith<$Res>  {
  factory $DraftRequestCopyWith(DraftRequest value, $Res Function(DraftRequest) _then) = _$DraftRequestCopyWithImpl;
@useResult
$Res call({
 String clientUuid, RequestType type, String title, int? projectId, int? costCenterId, String? neededDate, String? notes, List<int> requesterIds, int? bankAccountId, List<DraftLine> lines, int? serverId, int? serverRev, DraftSyncState syncState, String? lastError, DateTime? updatedAt
});




}
/// @nodoc
class _$DraftRequestCopyWithImpl<$Res>
    implements $DraftRequestCopyWith<$Res> {
  _$DraftRequestCopyWithImpl(this._self, this._then);

  final DraftRequest _self;
  final $Res Function(DraftRequest) _then;

/// Create a copy of DraftRequest
/// with the given fields replaced by the non-null parameter values.
@pragma('vm:prefer-inline') @override $Res call({Object? clientUuid = null,Object? type = null,Object? title = null,Object? projectId = freezed,Object? costCenterId = freezed,Object? neededDate = freezed,Object? notes = freezed,Object? requesterIds = null,Object? bankAccountId = freezed,Object? lines = null,Object? serverId = freezed,Object? serverRev = freezed,Object? syncState = null,Object? lastError = freezed,Object? updatedAt = freezed,}) {
  return _then(DraftRequest(
clientUuid: null == clientUuid ? _self.clientUuid : clientUuid // ignore: cast_nullable_to_non_nullable
as String,type: null == type ? _self.type : type // ignore: cast_nullable_to_non_nullable
as RequestType,title: null == title ? _self.title : title // ignore: cast_nullable_to_non_nullable
as String,projectId: freezed == projectId ? _self.projectId : projectId // ignore: cast_nullable_to_non_nullable
as int?,costCenterId: freezed == costCenterId ? _self.costCenterId : costCenterId // ignore: cast_nullable_to_non_nullable
as int?,neededDate: freezed == neededDate ? _self.neededDate : neededDate // ignore: cast_nullable_to_non_nullable
as String?,notes: freezed == notes ? _self.notes : notes // ignore: cast_nullable_to_non_nullable
as String?,requesterIds: null == requesterIds ? _self.requesterIds : requesterIds // ignore: cast_nullable_to_non_nullable
as List<int>,bankAccountId: freezed == bankAccountId ? _self.bankAccountId : bankAccountId // ignore: cast_nullable_to_non_nullable
as int?,lines: null == lines ? _self.lines : lines // ignore: cast_nullable_to_non_nullable
as List<DraftLine>,serverId: freezed == serverId ? _self.serverId : serverId // ignore: cast_nullable_to_non_nullable
as int?,serverRev: freezed == serverRev ? _self.serverRev : serverRev // ignore: cast_nullable_to_non_nullable
as int?,syncState: null == syncState ? _self.syncState : syncState // ignore: cast_nullable_to_non_nullable
as DraftSyncState,lastError: freezed == lastError ? _self.lastError : lastError // ignore: cast_nullable_to_non_nullable
as String?,updatedAt: freezed == updatedAt ? _self.updatedAt : updatedAt // ignore: cast_nullable_to_non_nullable
as DateTime?,
  ));
}

}


/// Adds pattern-matching-related methods to [DraftRequest].
extension DraftRequestPatterns on DraftRequest {
/// A variant of `map` that fallback to returning `orElse`.
///
/// It is equivalent to doing:
/// ```dart
/// switch (sealedClass) {
///   case final Subclass value:
///     return ...;
///   case _:
///     return orElse();
/// }
/// ```

@optionalTypeArgs TResult maybeMap<TResult extends Object?>(TResult Function( _DraftRequest value)?  $default,{required TResult orElse(),}){
final _that = this;
switch (_that) {
case _DraftRequest() when $default != null:
return $default(_that);case _:
  return orElse();

}
}
/// A `switch`-like method, using callbacks.
///
/// Callbacks receives the raw object, upcasted.
/// It is equivalent to doing:
/// ```dart
/// switch (sealedClass) {
///   case final Subclass value:
///     return ...;
///   case final Subclass2 value:
///     return ...;
/// }
/// ```

@optionalTypeArgs TResult map<TResult extends Object?>(TResult Function( _DraftRequest value)  $default,){
final _that = this;
switch (_that) {
case _DraftRequest():
return $default(_that);case _:
  throw StateError('Unexpected subclass');

}
}
/// A variant of `map` that fallback to returning `null`.
///
/// It is equivalent to doing:
/// ```dart
/// switch (sealedClass) {
///   case final Subclass value:
///     return ...;
///   case _:
///     return null;
/// }
/// ```

@optionalTypeArgs TResult? mapOrNull<TResult extends Object?>(TResult? Function( _DraftRequest value)?  $default,){
final _that = this;
switch (_that) {
case _DraftRequest() when $default != null:
return $default(_that);case _:
  return null;

}
}
/// A variant of `when` that fallback to an `orElse` callback.
///
/// It is equivalent to doing:
/// ```dart
/// switch (sealedClass) {
///   case Subclass(:final field):
///     return ...;
///   case _:
///     return orElse();
/// }
/// ```

@optionalTypeArgs TResult maybeWhen<TResult extends Object?>(TResult Function( String clientUuid,  RequestType type,  String title,  int? projectId,  int? costCenterId,  String? neededDate,  String? notes,  List<int> requesterIds,  int? bankAccountId,  List<DraftLine> lines,  int? serverId,  int? serverRev,  DraftSyncState syncState,  String? lastError,  DateTime? updatedAt)?  $default,{required TResult orElse(),}) {final _that = this;
switch (_that) {
case _DraftRequest() when $default != null:
return $default(_that.clientUuid,_that.type,_that.title,_that.projectId,_that.costCenterId,_that.neededDate,_that.notes,_that.requesterIds,_that.bankAccountId,_that.lines,_that.serverId,_that.serverRev,_that.syncState,_that.lastError,_that.updatedAt);case _:
  return orElse();

}
}
/// A `switch`-like method, using callbacks.
///
/// As opposed to `map`, this offers destructuring.
/// It is equivalent to doing:
/// ```dart
/// switch (sealedClass) {
///   case Subclass(:final field):
///     return ...;
///   case Subclass2(:final field2):
///     return ...;
/// }
/// ```

@optionalTypeArgs TResult when<TResult extends Object?>(TResult Function( String clientUuid,  RequestType type,  String title,  int? projectId,  int? costCenterId,  String? neededDate,  String? notes,  List<int> requesterIds,  int? bankAccountId,  List<DraftLine> lines,  int? serverId,  int? serverRev,  DraftSyncState syncState,  String? lastError,  DateTime? updatedAt)  $default,) {final _that = this;
switch (_that) {
case _DraftRequest():
return $default(_that.clientUuid,_that.type,_that.title,_that.projectId,_that.costCenterId,_that.neededDate,_that.notes,_that.requesterIds,_that.bankAccountId,_that.lines,_that.serverId,_that.serverRev,_that.syncState,_that.lastError,_that.updatedAt);case _:
  throw StateError('Unexpected subclass');

}
}
/// A variant of `when` that fallback to returning `null`
///
/// It is equivalent to doing:
/// ```dart
/// switch (sealedClass) {
///   case Subclass(:final field):
///     return ...;
///   case _:
///     return null;
/// }
/// ```

@optionalTypeArgs TResult? whenOrNull<TResult extends Object?>(TResult? Function( String clientUuid,  RequestType type,  String title,  int? projectId,  int? costCenterId,  String? neededDate,  String? notes,  List<int> requesterIds,  int? bankAccountId,  List<DraftLine> lines,  int? serverId,  int? serverRev,  DraftSyncState syncState,  String? lastError,  DateTime? updatedAt)?  $default,) {final _that = this;
switch (_that) {
case _DraftRequest() when $default != null:
return $default(_that.clientUuid,_that.type,_that.title,_that.projectId,_that.costCenterId,_that.neededDate,_that.notes,_that.requesterIds,_that.bankAccountId,_that.lines,_that.serverId,_that.serverRev,_that.syncState,_that.lastError,_that.updatedAt);case _:
  return null;

}
}

}

/// @nodoc


class _DraftRequest extends DraftRequest {
  const _DraftRequest({required this.clientUuid, required this.type, this.title = '', this.projectId, this.costCenterId, this.neededDate, this.notes,  List<int> requesterIds = const [], this.bankAccountId,  List<DraftLine> lines = const [], this.serverId, this.serverRev, this.syncState = DraftSyncState.local, this.lastError, this.updatedAt}): _requesterIds = requesterIds,_lines = lines,super._();
  

@override final  String clientUuid;
@override final  RequestType type;
@override@JsonKey() final  String title;
@override final  int? projectId;
@override final  int? costCenterId;
@override final  String? neededDate;
@override final  String? notes;
 final  List<int> _requesterIds;
@override@JsonKey() List<int> get requesterIds {
  if (_requesterIds is EqualUnmodifiableListView) return _requesterIds;
  // ignore: implicit_dynamic_type
  return EqualUnmodifiableListView(_requesterIds);
}

@override final  int? bankAccountId;
 final  List<DraftLine> _lines;
@override@JsonKey() List<DraftLine> get lines {
  if (_lines is EqualUnmodifiableListView) return _lines;
  // ignore: implicit_dynamic_type
  return EqualUnmodifiableListView(_lines);
}

@override final  int? serverId;
@override final  int? serverRev;
@override@JsonKey() final  DraftSyncState syncState;
@override final  String? lastError;
@override final  DateTime? updatedAt;

/// Create a copy of DraftRequest
/// with the given fields replaced by the non-null parameter values.
@override @JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
_$DraftRequestCopyWith<_DraftRequest> get copyWith => __$DraftRequestCopyWithImpl<_DraftRequest>(this, _$identity);



@override
bool operator ==(Object other) {
    return identical(this, other) || (other.runtimeType == runtimeType&&other is _DraftRequest&&(identical(other.clientUuid, clientUuid) || other.clientUuid == clientUuid)&&(identical(other.type, type) || other.type == type)&&(identical(other.title, title) || other.title == title)&&(identical(other.projectId, projectId) || other.projectId == projectId)&&(identical(other.costCenterId, costCenterId) || other.costCenterId == costCenterId)&&(identical(other.neededDate, neededDate) || other.neededDate == neededDate)&&(identical(other.notes, notes) || other.notes == notes)&&const DeepCollectionEquality().equals(other.requesterIds, _requesterIds)&&(identical(other.bankAccountId, bankAccountId) || other.bankAccountId == bankAccountId)&&const DeepCollectionEquality().equals(other.lines, _lines)&&(identical(other.serverId, serverId) || other.serverId == serverId)&&(identical(other.serverRev, serverRev) || other.serverRev == serverRev)&&(identical(other.syncState, syncState) || other.syncState == syncState)&&(identical(other.lastError, lastError) || other.lastError == lastError)&&(identical(other.updatedAt, updatedAt) || other.updatedAt == updatedAt));
}


@override
int get hashCode {
    return Object.hash(runtimeType,clientUuid,type,title,projectId,costCenterId,neededDate,notes,const DeepCollectionEquality().hash(_requesterIds),bankAccountId,const DeepCollectionEquality().hash(_lines),serverId,serverRev,syncState,lastError,updatedAt);
}

@override
String toString() {
    return 'DraftRequest(clientUuid: $clientUuid, type: $type, title: $title, projectId: $projectId, costCenterId: $costCenterId, neededDate: $neededDate, notes: $notes, requesterIds: $requesterIds, bankAccountId: $bankAccountId, lines: $lines, serverId: $serverId, serverRev: $serverRev, syncState: $syncState, lastError: $lastError, updatedAt: $updatedAt)';
}


}

/// @nodoc
abstract mixin class _$DraftRequestCopyWith<$Res> implements $DraftRequestCopyWith<$Res> {
  factory _$DraftRequestCopyWith(_DraftRequest value, $Res Function(_DraftRequest) _then) = __$DraftRequestCopyWithImpl;
@override @useResult
$Res call({
 String clientUuid, RequestType type, String title, int? projectId, int? costCenterId, String? neededDate, String? notes, List<int> requesterIds, int? bankAccountId, List<DraftLine> lines, int? serverId, int? serverRev, DraftSyncState syncState, String? lastError, DateTime? updatedAt
});




}
/// @nodoc
class __$DraftRequestCopyWithImpl<$Res>
    implements _$DraftRequestCopyWith<$Res> {
  __$DraftRequestCopyWithImpl(this._self, this._then);

  final _DraftRequest _self;
  final $Res Function(_DraftRequest) _then;

/// Create a copy of DraftRequest
/// with the given fields replaced by the non-null parameter values.
@override @pragma('vm:prefer-inline') $Res call({Object? clientUuid = null,Object? type = null,Object? title = null,Object? projectId = freezed,Object? costCenterId = freezed,Object? neededDate = freezed,Object? notes = freezed,Object? requesterIds = null,Object? bankAccountId = freezed,Object? lines = null,Object? serverId = freezed,Object? serverRev = freezed,Object? syncState = null,Object? lastError = freezed,Object? updatedAt = freezed,}) {
  return _then(_DraftRequest(
clientUuid: null == clientUuid ? _self.clientUuid : clientUuid // ignore: cast_nullable_to_non_nullable
as String,type: null == type ? _self.type : type // ignore: cast_nullable_to_non_nullable
as RequestType,title: null == title ? _self.title : title // ignore: cast_nullable_to_non_nullable
as String,projectId: freezed == projectId ? _self.projectId : projectId // ignore: cast_nullable_to_non_nullable
as int?,costCenterId: freezed == costCenterId ? _self.costCenterId : costCenterId // ignore: cast_nullable_to_non_nullable
as int?,neededDate: freezed == neededDate ? _self.neededDate : neededDate // ignore: cast_nullable_to_non_nullable
as String?,notes: freezed == notes ? _self.notes : notes // ignore: cast_nullable_to_non_nullable
as String?,requesterIds: null == requesterIds ? _self._requesterIds : requesterIds // ignore: cast_nullable_to_non_nullable
as List<int>,bankAccountId: freezed == bankAccountId ? _self.bankAccountId : bankAccountId // ignore: cast_nullable_to_non_nullable
as int?,lines: null == lines ? _self._lines : lines // ignore: cast_nullable_to_non_nullable
as List<DraftLine>,serverId: freezed == serverId ? _self.serverId : serverId // ignore: cast_nullable_to_non_nullable
as int?,serverRev: freezed == serverRev ? _self.serverRev : serverRev // ignore: cast_nullable_to_non_nullable
as int?,syncState: null == syncState ? _self.syncState : syncState // ignore: cast_nullable_to_non_nullable
as DraftSyncState,lastError: freezed == lastError ? _self.lastError : lastError // ignore: cast_nullable_to_non_nullable
as String?,updatedAt: freezed == updatedAt ? _self.updatedAt : updatedAt // ignore: cast_nullable_to_non_nullable
as DateTime?,
  ));
}


}

// dart format on
