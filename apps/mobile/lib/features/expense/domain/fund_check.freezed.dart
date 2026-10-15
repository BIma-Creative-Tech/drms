// GENERATED CODE - DO NOT MODIFY BY HAND
// coverage:ignore-file
// ignore_for_file: type=lint, type=warning, deprecated_member_use, deprecated_member_use_from_same_package
// ignore_for_file: unused_element, deprecated_member_use, deprecated_member_use_from_same_package, use_function_type_syntax_for_parameters, unnecessary_const, avoid_init_to_null, invalid_override_different_default_values_named, prefer_expression_function_bodies, annotate_overrides, invalid_annotation_target, unnecessary_question_mark

part of 'fund_check.dart';

// **************************************************************************
// FreezedGenerator
// **************************************************************************

// GENERATED CODE - DO NOT MODIFY BY HAND
// dart format off
T _$identity<T>(T value) => value;
/// @nodoc
mixin _$FundCommitmentItem {

/// request | shortfall | loan (loan: [id] = the inter-PT loan the PT lends, not yet disbursed).
 String get kind; int get id; String? get docNo; int get amount; String get status;
/// Create a copy of FundCommitmentItem
/// with the given fields replaced by the non-null parameter values.
@JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$FundCommitmentItemCopyWith<FundCommitmentItem> get copyWith => _$FundCommitmentItemCopyWithImpl<FundCommitmentItem>(this as FundCommitmentItem, _$identity);



@override
bool operator ==(Object other) {
  final _this = this as FundCommitmentItem;
  return identical(this, other) || (other.runtimeType == runtimeType&&other is FundCommitmentItem&&(identical(other.kind, _this.kind) || other.kind == _this.kind)&&(identical(other.id, _this.id) || other.id == _this.id)&&(identical(other.docNo, _this.docNo) || other.docNo == _this.docNo)&&(identical(other.amount, _this.amount) || other.amount == _this.amount)&&(identical(other.status, _this.status) || other.status == _this.status));
}


@override
int get hashCode {
  final _this = this as FundCommitmentItem;
  return Object.hash(runtimeType,_this.kind,_this.id,_this.docNo,_this.amount,_this.status);
}

@override
String toString() {
  final _this = this as FundCommitmentItem;
  return 'FundCommitmentItem(kind: ${_this.kind}, id: ${_this.id}, docNo: ${_this.docNo}, amount: ${_this.amount}, status: ${_this.status})';
}


}

/// @nodoc
abstract mixin class $FundCommitmentItemCopyWith<$Res>  {
  factory $FundCommitmentItemCopyWith(FundCommitmentItem value, $Res Function(FundCommitmentItem) _then) = _$FundCommitmentItemCopyWithImpl;
@useResult
$Res call({
 String kind, int id, String? docNo, int amount, String status
});




}
/// @nodoc
class _$FundCommitmentItemCopyWithImpl<$Res>
    implements $FundCommitmentItemCopyWith<$Res> {
  _$FundCommitmentItemCopyWithImpl(this._self, this._then);

  final FundCommitmentItem _self;
  final $Res Function(FundCommitmentItem) _then;

/// Create a copy of FundCommitmentItem
/// with the given fields replaced by the non-null parameter values.
@pragma('vm:prefer-inline') @override $Res call({Object? kind = null,Object? id = null,Object? docNo = freezed,Object? amount = null,Object? status = null,}) {
  return _then(FundCommitmentItem(
kind: null == kind ? _self.kind : kind // ignore: cast_nullable_to_non_nullable
as String,id: null == id ? _self.id : id // ignore: cast_nullable_to_non_nullable
as int,docNo: freezed == docNo ? _self.docNo : docNo // ignore: cast_nullable_to_non_nullable
as String?,amount: null == amount ? _self.amount : amount // ignore: cast_nullable_to_non_nullable
as int,status: null == status ? _self.status : status // ignore: cast_nullable_to_non_nullable
as String,
  ));
}

}


/// Adds pattern-matching-related methods to [FundCommitmentItem].
extension FundCommitmentItemPatterns on FundCommitmentItem {
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

@optionalTypeArgs TResult maybeMap<TResult extends Object?>(TResult Function( _FundCommitmentItem value)?  $default,{required TResult orElse(),}){
final _that = this;
switch (_that) {
case _FundCommitmentItem() when $default != null:
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

@optionalTypeArgs TResult map<TResult extends Object?>(TResult Function( _FundCommitmentItem value)  $default,){
final _that = this;
switch (_that) {
case _FundCommitmentItem():
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

@optionalTypeArgs TResult? mapOrNull<TResult extends Object?>(TResult? Function( _FundCommitmentItem value)?  $default,){
final _that = this;
switch (_that) {
case _FundCommitmentItem() when $default != null:
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

@optionalTypeArgs TResult maybeWhen<TResult extends Object?>(TResult Function( String kind,  int id,  String? docNo,  int amount,  String status)?  $default,{required TResult orElse(),}) {final _that = this;
switch (_that) {
case _FundCommitmentItem() when $default != null:
return $default(_that.kind,_that.id,_that.docNo,_that.amount,_that.status);case _:
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

@optionalTypeArgs TResult when<TResult extends Object?>(TResult Function( String kind,  int id,  String? docNo,  int amount,  String status)  $default,) {final _that = this;
switch (_that) {
case _FundCommitmentItem():
return $default(_that.kind,_that.id,_that.docNo,_that.amount,_that.status);case _:
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

@optionalTypeArgs TResult? whenOrNull<TResult extends Object?>(TResult? Function( String kind,  int id,  String? docNo,  int amount,  String status)?  $default,) {final _that = this;
switch (_that) {
case _FundCommitmentItem() when $default != null:
return $default(_that.kind,_that.id,_that.docNo,_that.amount,_that.status);case _:
  return null;

}
}

}

/// @nodoc


class _FundCommitmentItem extends FundCommitmentItem {
  const _FundCommitmentItem({required this.kind, required this.id, this.docNo, required this.amount, this.status = ''}): super._();
  

/// request | shortfall | loan (loan: [id] = the inter-PT loan the PT lends, not yet disbursed).
@override final  String kind;
@override final  int id;
@override final  String? docNo;
@override final  int amount;
@override@JsonKey() final  String status;

/// Create a copy of FundCommitmentItem
/// with the given fields replaced by the non-null parameter values.
@override @JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
_$FundCommitmentItemCopyWith<_FundCommitmentItem> get copyWith => __$FundCommitmentItemCopyWithImpl<_FundCommitmentItem>(this, _$identity);



@override
bool operator ==(Object other) {
    return identical(this, other) || (other.runtimeType == runtimeType&&other is _FundCommitmentItem&&(identical(other.kind, kind) || other.kind == kind)&&(identical(other.id, id) || other.id == id)&&(identical(other.docNo, docNo) || other.docNo == docNo)&&(identical(other.amount, amount) || other.amount == amount)&&(identical(other.status, status) || other.status == status));
}


@override
int get hashCode {
    return Object.hash(runtimeType,kind,id,docNo,amount,status);
}

@override
String toString() {
    return 'FundCommitmentItem(kind: $kind, id: $id, docNo: $docNo, amount: $amount, status: $status)';
}


}

/// @nodoc
abstract mixin class _$FundCommitmentItemCopyWith<$Res> implements $FundCommitmentItemCopyWith<$Res> {
  factory _$FundCommitmentItemCopyWith(_FundCommitmentItem value, $Res Function(_FundCommitmentItem) _then) = __$FundCommitmentItemCopyWithImpl;
@override @useResult
$Res call({
 String kind, int id, String? docNo, int amount, String status
});




}
/// @nodoc
class __$FundCommitmentItemCopyWithImpl<$Res>
    implements _$FundCommitmentItemCopyWith<$Res> {
  __$FundCommitmentItemCopyWithImpl(this._self, this._then);

  final _FundCommitmentItem _self;
  final $Res Function(_FundCommitmentItem) _then;

/// Create a copy of FundCommitmentItem
/// with the given fields replaced by the non-null parameter values.
@override @pragma('vm:prefer-inline') $Res call({Object? kind = null,Object? id = null,Object? docNo = freezed,Object? amount = null,Object? status = null,}) {
  return _then(_FundCommitmentItem(
kind: null == kind ? _self.kind : kind // ignore: cast_nullable_to_non_nullable
as String,id: null == id ? _self.id : id // ignore: cast_nullable_to_non_nullable
as int,docNo: freezed == docNo ? _self.docNo : docNo // ignore: cast_nullable_to_non_nullable
as String?,amount: null == amount ? _self.amount : amount // ignore: cast_nullable_to_non_nullable
as int,status: null == status ? _self.status : status // ignore: cast_nullable_to_non_nullable
as String,
  ));
}


}

/// @nodoc
mixin _$FundLoanRef {

 int get id; String get docNo; String get status; int get amount; String? get lenderCode;
/// Create a copy of FundLoanRef
/// with the given fields replaced by the non-null parameter values.
@JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$FundLoanRefCopyWith<FundLoanRef> get copyWith => _$FundLoanRefCopyWithImpl<FundLoanRef>(this as FundLoanRef, _$identity);



@override
bool operator ==(Object other) {
  final _this = this as FundLoanRef;
  return identical(this, other) || (other.runtimeType == runtimeType&&other is FundLoanRef&&(identical(other.id, _this.id) || other.id == _this.id)&&(identical(other.docNo, _this.docNo) || other.docNo == _this.docNo)&&(identical(other.status, _this.status) || other.status == _this.status)&&(identical(other.amount, _this.amount) || other.amount == _this.amount)&&(identical(other.lenderCode, _this.lenderCode) || other.lenderCode == _this.lenderCode));
}


@override
int get hashCode {
  final _this = this as FundLoanRef;
  return Object.hash(runtimeType,_this.id,_this.docNo,_this.status,_this.amount,_this.lenderCode);
}

@override
String toString() {
  final _this = this as FundLoanRef;
  return 'FundLoanRef(id: ${_this.id}, docNo: ${_this.docNo}, status: ${_this.status}, amount: ${_this.amount}, lenderCode: ${_this.lenderCode})';
}


}

/// @nodoc
abstract mixin class $FundLoanRefCopyWith<$Res>  {
  factory $FundLoanRefCopyWith(FundLoanRef value, $Res Function(FundLoanRef) _then) = _$FundLoanRefCopyWithImpl;
@useResult
$Res call({
 int id, String docNo, String status, int amount, String? lenderCode
});




}
/// @nodoc
class _$FundLoanRefCopyWithImpl<$Res>
    implements $FundLoanRefCopyWith<$Res> {
  _$FundLoanRefCopyWithImpl(this._self, this._then);

  final FundLoanRef _self;
  final $Res Function(FundLoanRef) _then;

/// Create a copy of FundLoanRef
/// with the given fields replaced by the non-null parameter values.
@pragma('vm:prefer-inline') @override $Res call({Object? id = null,Object? docNo = null,Object? status = null,Object? amount = null,Object? lenderCode = freezed,}) {
  return _then(FundLoanRef(
id: null == id ? _self.id : id // ignore: cast_nullable_to_non_nullable
as int,docNo: null == docNo ? _self.docNo : docNo // ignore: cast_nullable_to_non_nullable
as String,status: null == status ? _self.status : status // ignore: cast_nullable_to_non_nullable
as String,amount: null == amount ? _self.amount : amount // ignore: cast_nullable_to_non_nullable
as int,lenderCode: freezed == lenderCode ? _self.lenderCode : lenderCode // ignore: cast_nullable_to_non_nullable
as String?,
  ));
}

}


/// Adds pattern-matching-related methods to [FundLoanRef].
extension FundLoanRefPatterns on FundLoanRef {
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

@optionalTypeArgs TResult maybeMap<TResult extends Object?>(TResult Function( _FundLoanRef value)?  $default,{required TResult orElse(),}){
final _that = this;
switch (_that) {
case _FundLoanRef() when $default != null:
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

@optionalTypeArgs TResult map<TResult extends Object?>(TResult Function( _FundLoanRef value)  $default,){
final _that = this;
switch (_that) {
case _FundLoanRef():
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

@optionalTypeArgs TResult? mapOrNull<TResult extends Object?>(TResult? Function( _FundLoanRef value)?  $default,){
final _that = this;
switch (_that) {
case _FundLoanRef() when $default != null:
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

@optionalTypeArgs TResult maybeWhen<TResult extends Object?>(TResult Function( int id,  String docNo,  String status,  int amount,  String? lenderCode)?  $default,{required TResult orElse(),}) {final _that = this;
switch (_that) {
case _FundLoanRef() when $default != null:
return $default(_that.id,_that.docNo,_that.status,_that.amount,_that.lenderCode);case _:
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

@optionalTypeArgs TResult when<TResult extends Object?>(TResult Function( int id,  String docNo,  String status,  int amount,  String? lenderCode)  $default,) {final _that = this;
switch (_that) {
case _FundLoanRef():
return $default(_that.id,_that.docNo,_that.status,_that.amount,_that.lenderCode);case _:
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

@optionalTypeArgs TResult? whenOrNull<TResult extends Object?>(TResult? Function( int id,  String docNo,  String status,  int amount,  String? lenderCode)?  $default,) {final _that = this;
switch (_that) {
case _FundLoanRef() when $default != null:
return $default(_that.id,_that.docNo,_that.status,_that.amount,_that.lenderCode);case _:
  return null;

}
}

}

/// @nodoc


class _FundLoanRef extends FundLoanRef {
  const _FundLoanRef({required this.id, required this.docNo, required this.status, required this.amount, this.lenderCode}): super._();
  

@override final  int id;
@override final  String docNo;
@override final  String status;
@override final  int amount;
@override final  String? lenderCode;

/// Create a copy of FundLoanRef
/// with the given fields replaced by the non-null parameter values.
@override @JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
_$FundLoanRefCopyWith<_FundLoanRef> get copyWith => __$FundLoanRefCopyWithImpl<_FundLoanRef>(this, _$identity);



@override
bool operator ==(Object other) {
    return identical(this, other) || (other.runtimeType == runtimeType&&other is _FundLoanRef&&(identical(other.id, id) || other.id == id)&&(identical(other.docNo, docNo) || other.docNo == docNo)&&(identical(other.status, status) || other.status == status)&&(identical(other.amount, amount) || other.amount == amount)&&(identical(other.lenderCode, lenderCode) || other.lenderCode == lenderCode));
}


@override
int get hashCode {
    return Object.hash(runtimeType,id,docNo,status,amount,lenderCode);
}

@override
String toString() {
    return 'FundLoanRef(id: $id, docNo: $docNo, status: $status, amount: $amount, lenderCode: $lenderCode)';
}


}

/// @nodoc
abstract mixin class _$FundLoanRefCopyWith<$Res> implements $FundLoanRefCopyWith<$Res> {
  factory _$FundLoanRefCopyWith(_FundLoanRef value, $Res Function(_FundLoanRef) _then) = __$FundLoanRefCopyWithImpl;
@override @useResult
$Res call({
 int id, String docNo, String status, int amount, String? lenderCode
});




}
/// @nodoc
class __$FundLoanRefCopyWithImpl<$Res>
    implements _$FundLoanRefCopyWith<$Res> {
  __$FundLoanRefCopyWithImpl(this._self, this._then);

  final _FundLoanRef _self;
  final $Res Function(_FundLoanRef) _then;

/// Create a copy of FundLoanRef
/// with the given fields replaced by the non-null parameter values.
@override @pragma('vm:prefer-inline') $Res call({Object? id = null,Object? docNo = null,Object? status = null,Object? amount = null,Object? lenderCode = freezed,}) {
  return _then(_FundLoanRef(
id: null == id ? _self.id : id // ignore: cast_nullable_to_non_nullable
as int,docNo: null == docNo ? _self.docNo : docNo // ignore: cast_nullable_to_non_nullable
as String,status: null == status ? _self.status : status // ignore: cast_nullable_to_non_nullable
as String,amount: null == amount ? _self.amount : amount // ignore: cast_nullable_to_non_nullable
as int,lenderCode: freezed == lenderCode ? _self.lenderCode : lenderCode // ignore: cast_nullable_to_non_nullable
as String?,
  ));
}


}

/// @nodoc
mixin _$FundCheck {

 int get companyId; String? get companyCode; String? get companyName;/// `companies.fundCheckEnabled` — off: the panel is information only (no block).
 bool get enabled;/// The request's NEXT decision makes it "Disetujui" (Owner level / final level), or the Owner's own Draft.
 bool get applies; FundCheckStatus get status;/// enabled ∧ applies ∧ insufficient: "Setujui" (or "Kirim") is refused by the server (409 FUND_INSUFFICIENT).
 bool get blocked; String? get blockedText; int get balance; int get commitments; int get available; int get needed; int get gap;/// "n akun, tanpa akun site".
 int get accountCount; int get excludedSiteCount; int get excludedSiteBalance;/// Other requests of the PT waiting at their final decision (not committed).
 int get waitingCount; int get waitingAmount; List<FundCommitmentItem> get commitmentItems; List<FundLoanRef> get loans;
/// Create a copy of FundCheck
/// with the given fields replaced by the non-null parameter values.
@JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$FundCheckCopyWith<FundCheck> get copyWith => _$FundCheckCopyWithImpl<FundCheck>(this as FundCheck, _$identity);



@override
bool operator ==(Object other) {
  final _this = this as FundCheck;
  return identical(this, other) || (other.runtimeType == runtimeType&&other is FundCheck&&(identical(other.companyId, _this.companyId) || other.companyId == _this.companyId)&&(identical(other.companyCode, _this.companyCode) || other.companyCode == _this.companyCode)&&(identical(other.companyName, _this.companyName) || other.companyName == _this.companyName)&&(identical(other.enabled, _this.enabled) || other.enabled == _this.enabled)&&(identical(other.applies, _this.applies) || other.applies == _this.applies)&&(identical(other.status, _this.status) || other.status == _this.status)&&(identical(other.blocked, _this.blocked) || other.blocked == _this.blocked)&&(identical(other.blockedText, _this.blockedText) || other.blockedText == _this.blockedText)&&(identical(other.balance, _this.balance) || other.balance == _this.balance)&&(identical(other.commitments, _this.commitments) || other.commitments == _this.commitments)&&(identical(other.available, _this.available) || other.available == _this.available)&&(identical(other.needed, _this.needed) || other.needed == _this.needed)&&(identical(other.gap, _this.gap) || other.gap == _this.gap)&&(identical(other.accountCount, _this.accountCount) || other.accountCount == _this.accountCount)&&(identical(other.excludedSiteCount, _this.excludedSiteCount) || other.excludedSiteCount == _this.excludedSiteCount)&&(identical(other.excludedSiteBalance, _this.excludedSiteBalance) || other.excludedSiteBalance == _this.excludedSiteBalance)&&(identical(other.waitingCount, _this.waitingCount) || other.waitingCount == _this.waitingCount)&&(identical(other.waitingAmount, _this.waitingAmount) || other.waitingAmount == _this.waitingAmount)&&const DeepCollectionEquality().equals(other.commitmentItems, _this.commitmentItems)&&const DeepCollectionEquality().equals(other.loans, _this.loans));
}


@override
int get hashCode {
  final _this = this as FundCheck;
  return Object.hashAll([runtimeType,_this.companyId,_this.companyCode,_this.companyName,_this.enabled,_this.applies,_this.status,_this.blocked,_this.blockedText,_this.balance,_this.commitments,_this.available,_this.needed,_this.gap,_this.accountCount,_this.excludedSiteCount,_this.excludedSiteBalance,_this.waitingCount,_this.waitingAmount,const DeepCollectionEquality().hash(_this.commitmentItems),const DeepCollectionEquality().hash(_this.loans)]);
}

@override
String toString() {
  final _this = this as FundCheck;
  return 'FundCheck(companyId: ${_this.companyId}, companyCode: ${_this.companyCode}, companyName: ${_this.companyName}, enabled: ${_this.enabled}, applies: ${_this.applies}, status: ${_this.status}, blocked: ${_this.blocked}, blockedText: ${_this.blockedText}, balance: ${_this.balance}, commitments: ${_this.commitments}, available: ${_this.available}, needed: ${_this.needed}, gap: ${_this.gap}, accountCount: ${_this.accountCount}, excludedSiteCount: ${_this.excludedSiteCount}, excludedSiteBalance: ${_this.excludedSiteBalance}, waitingCount: ${_this.waitingCount}, waitingAmount: ${_this.waitingAmount}, commitmentItems: ${_this.commitmentItems}, loans: ${_this.loans})';
}


}

/// @nodoc
abstract mixin class $FundCheckCopyWith<$Res>  {
  factory $FundCheckCopyWith(FundCheck value, $Res Function(FundCheck) _then) = _$FundCheckCopyWithImpl;
@useResult
$Res call({
 int companyId, String? companyCode, String? companyName, bool enabled, bool applies, FundCheckStatus status, bool blocked, String? blockedText, int balance, int commitments, int available, int needed, int gap, int accountCount, int excludedSiteCount, int excludedSiteBalance, int waitingCount, int waitingAmount, List<FundCommitmentItem> commitmentItems, List<FundLoanRef> loans
});




}
/// @nodoc
class _$FundCheckCopyWithImpl<$Res>
    implements $FundCheckCopyWith<$Res> {
  _$FundCheckCopyWithImpl(this._self, this._then);

  final FundCheck _self;
  final $Res Function(FundCheck) _then;

/// Create a copy of FundCheck
/// with the given fields replaced by the non-null parameter values.
@pragma('vm:prefer-inline') @override $Res call({Object? companyId = null,Object? companyCode = freezed,Object? companyName = freezed,Object? enabled = null,Object? applies = null,Object? status = null,Object? blocked = null,Object? blockedText = freezed,Object? balance = null,Object? commitments = null,Object? available = null,Object? needed = null,Object? gap = null,Object? accountCount = null,Object? excludedSiteCount = null,Object? excludedSiteBalance = null,Object? waitingCount = null,Object? waitingAmount = null,Object? commitmentItems = null,Object? loans = null,}) {
  return _then(FundCheck(
companyId: null == companyId ? _self.companyId : companyId // ignore: cast_nullable_to_non_nullable
as int,companyCode: freezed == companyCode ? _self.companyCode : companyCode // ignore: cast_nullable_to_non_nullable
as String?,companyName: freezed == companyName ? _self.companyName : companyName // ignore: cast_nullable_to_non_nullable
as String?,enabled: null == enabled ? _self.enabled : enabled // ignore: cast_nullable_to_non_nullable
as bool,applies: null == applies ? _self.applies : applies // ignore: cast_nullable_to_non_nullable
as bool,status: null == status ? _self.status : status // ignore: cast_nullable_to_non_nullable
as FundCheckStatus,blocked: null == blocked ? _self.blocked : blocked // ignore: cast_nullable_to_non_nullable
as bool,blockedText: freezed == blockedText ? _self.blockedText : blockedText // ignore: cast_nullable_to_non_nullable
as String?,balance: null == balance ? _self.balance : balance // ignore: cast_nullable_to_non_nullable
as int,commitments: null == commitments ? _self.commitments : commitments // ignore: cast_nullable_to_non_nullable
as int,available: null == available ? _self.available : available // ignore: cast_nullable_to_non_nullable
as int,needed: null == needed ? _self.needed : needed // ignore: cast_nullable_to_non_nullable
as int,gap: null == gap ? _self.gap : gap // ignore: cast_nullable_to_non_nullable
as int,accountCount: null == accountCount ? _self.accountCount : accountCount // ignore: cast_nullable_to_non_nullable
as int,excludedSiteCount: null == excludedSiteCount ? _self.excludedSiteCount : excludedSiteCount // ignore: cast_nullable_to_non_nullable
as int,excludedSiteBalance: null == excludedSiteBalance ? _self.excludedSiteBalance : excludedSiteBalance // ignore: cast_nullable_to_non_nullable
as int,waitingCount: null == waitingCount ? _self.waitingCount : waitingCount // ignore: cast_nullable_to_non_nullable
as int,waitingAmount: null == waitingAmount ? _self.waitingAmount : waitingAmount // ignore: cast_nullable_to_non_nullable
as int,commitmentItems: null == commitmentItems ? _self.commitmentItems : commitmentItems // ignore: cast_nullable_to_non_nullable
as List<FundCommitmentItem>,loans: null == loans ? _self.loans : loans // ignore: cast_nullable_to_non_nullable
as List<FundLoanRef>,
  ));
}

}


/// Adds pattern-matching-related methods to [FundCheck].
extension FundCheckPatterns on FundCheck {
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

@optionalTypeArgs TResult maybeMap<TResult extends Object?>(TResult Function( _FundCheck value)?  $default,{required TResult orElse(),}){
final _that = this;
switch (_that) {
case _FundCheck() when $default != null:
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

@optionalTypeArgs TResult map<TResult extends Object?>(TResult Function( _FundCheck value)  $default,){
final _that = this;
switch (_that) {
case _FundCheck():
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

@optionalTypeArgs TResult? mapOrNull<TResult extends Object?>(TResult? Function( _FundCheck value)?  $default,){
final _that = this;
switch (_that) {
case _FundCheck() when $default != null:
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

@optionalTypeArgs TResult maybeWhen<TResult extends Object?>(TResult Function( int companyId,  String? companyCode,  String? companyName,  bool enabled,  bool applies,  FundCheckStatus status,  bool blocked,  String? blockedText,  int balance,  int commitments,  int available,  int needed,  int gap,  int accountCount,  int excludedSiteCount,  int excludedSiteBalance,  int waitingCount,  int waitingAmount,  List<FundCommitmentItem> commitmentItems,  List<FundLoanRef> loans)?  $default,{required TResult orElse(),}) {final _that = this;
switch (_that) {
case _FundCheck() when $default != null:
return $default(_that.companyId,_that.companyCode,_that.companyName,_that.enabled,_that.applies,_that.status,_that.blocked,_that.blockedText,_that.balance,_that.commitments,_that.available,_that.needed,_that.gap,_that.accountCount,_that.excludedSiteCount,_that.excludedSiteBalance,_that.waitingCount,_that.waitingAmount,_that.commitmentItems,_that.loans);case _:
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

@optionalTypeArgs TResult when<TResult extends Object?>(TResult Function( int companyId,  String? companyCode,  String? companyName,  bool enabled,  bool applies,  FundCheckStatus status,  bool blocked,  String? blockedText,  int balance,  int commitments,  int available,  int needed,  int gap,  int accountCount,  int excludedSiteCount,  int excludedSiteBalance,  int waitingCount,  int waitingAmount,  List<FundCommitmentItem> commitmentItems,  List<FundLoanRef> loans)  $default,) {final _that = this;
switch (_that) {
case _FundCheck():
return $default(_that.companyId,_that.companyCode,_that.companyName,_that.enabled,_that.applies,_that.status,_that.blocked,_that.blockedText,_that.balance,_that.commitments,_that.available,_that.needed,_that.gap,_that.accountCount,_that.excludedSiteCount,_that.excludedSiteBalance,_that.waitingCount,_that.waitingAmount,_that.commitmentItems,_that.loans);case _:
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

@optionalTypeArgs TResult? whenOrNull<TResult extends Object?>(TResult? Function( int companyId,  String? companyCode,  String? companyName,  bool enabled,  bool applies,  FundCheckStatus status,  bool blocked,  String? blockedText,  int balance,  int commitments,  int available,  int needed,  int gap,  int accountCount,  int excludedSiteCount,  int excludedSiteBalance,  int waitingCount,  int waitingAmount,  List<FundCommitmentItem> commitmentItems,  List<FundLoanRef> loans)?  $default,) {final _that = this;
switch (_that) {
case _FundCheck() when $default != null:
return $default(_that.companyId,_that.companyCode,_that.companyName,_that.enabled,_that.applies,_that.status,_that.blocked,_that.blockedText,_that.balance,_that.commitments,_that.available,_that.needed,_that.gap,_that.accountCount,_that.excludedSiteCount,_that.excludedSiteBalance,_that.waitingCount,_that.waitingAmount,_that.commitmentItems,_that.loans);case _:
  return null;

}
}

}

/// @nodoc


class _FundCheck extends FundCheck {
  const _FundCheck({required this.companyId, this.companyCode, this.companyName, this.enabled = false, this.applies = false, this.status = FundCheckStatus.notApplicable, this.blocked = false, this.blockedText, this.balance = 0, this.commitments = 0, this.available = 0, this.needed = 0, this.gap = 0, this.accountCount = 0, this.excludedSiteCount = 0, this.excludedSiteBalance = 0, this.waitingCount = 0, this.waitingAmount = 0,  List<FundCommitmentItem> commitmentItems = const <FundCommitmentItem>[],  List<FundLoanRef> loans = const <FundLoanRef>[]}): _commitmentItems = commitmentItems,_loans = loans,super._();
  

@override final  int companyId;
@override final  String? companyCode;
@override final  String? companyName;
/// `companies.fundCheckEnabled` — off: the panel is information only (no block).
@override@JsonKey() final  bool enabled;
/// The request's NEXT decision makes it "Disetujui" (Owner level / final level), or the Owner's own Draft.
@override@JsonKey() final  bool applies;
@override@JsonKey() final  FundCheckStatus status;
/// enabled ∧ applies ∧ insufficient: "Setujui" (or "Kirim") is refused by the server (409 FUND_INSUFFICIENT).
@override@JsonKey() final  bool blocked;
@override final  String? blockedText;
@override@JsonKey() final  int balance;
@override@JsonKey() final  int commitments;
@override@JsonKey() final  int available;
@override@JsonKey() final  int needed;
@override@JsonKey() final  int gap;
/// "n akun, tanpa akun site".
@override@JsonKey() final  int accountCount;
@override@JsonKey() final  int excludedSiteCount;
@override@JsonKey() final  int excludedSiteBalance;
/// Other requests of the PT waiting at their final decision (not committed).
@override@JsonKey() final  int waitingCount;
@override@JsonKey() final  int waitingAmount;
 final  List<FundCommitmentItem> _commitmentItems;
@override@JsonKey() List<FundCommitmentItem> get commitmentItems {
  if (_commitmentItems is EqualUnmodifiableListView) return _commitmentItems;
  // ignore: implicit_dynamic_type
  return EqualUnmodifiableListView(_commitmentItems);
}

 final  List<FundLoanRef> _loans;
@override@JsonKey() List<FundLoanRef> get loans {
  if (_loans is EqualUnmodifiableListView) return _loans;
  // ignore: implicit_dynamic_type
  return EqualUnmodifiableListView(_loans);
}


/// Create a copy of FundCheck
/// with the given fields replaced by the non-null parameter values.
@override @JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
_$FundCheckCopyWith<_FundCheck> get copyWith => __$FundCheckCopyWithImpl<_FundCheck>(this, _$identity);



@override
bool operator ==(Object other) {
    return identical(this, other) || (other.runtimeType == runtimeType&&other is _FundCheck&&(identical(other.companyId, companyId) || other.companyId == companyId)&&(identical(other.companyCode, companyCode) || other.companyCode == companyCode)&&(identical(other.companyName, companyName) || other.companyName == companyName)&&(identical(other.enabled, enabled) || other.enabled == enabled)&&(identical(other.applies, applies) || other.applies == applies)&&(identical(other.status, status) || other.status == status)&&(identical(other.blocked, blocked) || other.blocked == blocked)&&(identical(other.blockedText, blockedText) || other.blockedText == blockedText)&&(identical(other.balance, balance) || other.balance == balance)&&(identical(other.commitments, commitments) || other.commitments == commitments)&&(identical(other.available, available) || other.available == available)&&(identical(other.needed, needed) || other.needed == needed)&&(identical(other.gap, gap) || other.gap == gap)&&(identical(other.accountCount, accountCount) || other.accountCount == accountCount)&&(identical(other.excludedSiteCount, excludedSiteCount) || other.excludedSiteCount == excludedSiteCount)&&(identical(other.excludedSiteBalance, excludedSiteBalance) || other.excludedSiteBalance == excludedSiteBalance)&&(identical(other.waitingCount, waitingCount) || other.waitingCount == waitingCount)&&(identical(other.waitingAmount, waitingAmount) || other.waitingAmount == waitingAmount)&&const DeepCollectionEquality().equals(other.commitmentItems, _commitmentItems)&&const DeepCollectionEquality().equals(other.loans, _loans));
}


@override
int get hashCode {
    return Object.hashAll([runtimeType,companyId,companyCode,companyName,enabled,applies,status,blocked,blockedText,balance,commitments,available,needed,gap,accountCount,excludedSiteCount,excludedSiteBalance,waitingCount,waitingAmount,const DeepCollectionEquality().hash(_commitmentItems),const DeepCollectionEquality().hash(_loans)]);
}

@override
String toString() {
    return 'FundCheck(companyId: $companyId, companyCode: $companyCode, companyName: $companyName, enabled: $enabled, applies: $applies, status: $status, blocked: $blocked, blockedText: $blockedText, balance: $balance, commitments: $commitments, available: $available, needed: $needed, gap: $gap, accountCount: $accountCount, excludedSiteCount: $excludedSiteCount, excludedSiteBalance: $excludedSiteBalance, waitingCount: $waitingCount, waitingAmount: $waitingAmount, commitmentItems: $commitmentItems, loans: $loans)';
}


}

/// @nodoc
abstract mixin class _$FundCheckCopyWith<$Res> implements $FundCheckCopyWith<$Res> {
  factory _$FundCheckCopyWith(_FundCheck value, $Res Function(_FundCheck) _then) = __$FundCheckCopyWithImpl;
@override @useResult
$Res call({
 int companyId, String? companyCode, String? companyName, bool enabled, bool applies, FundCheckStatus status, bool blocked, String? blockedText, int balance, int commitments, int available, int needed, int gap, int accountCount, int excludedSiteCount, int excludedSiteBalance, int waitingCount, int waitingAmount, List<FundCommitmentItem> commitmentItems, List<FundLoanRef> loans
});




}
/// @nodoc
class __$FundCheckCopyWithImpl<$Res>
    implements _$FundCheckCopyWith<$Res> {
  __$FundCheckCopyWithImpl(this._self, this._then);

  final _FundCheck _self;
  final $Res Function(_FundCheck) _then;

/// Create a copy of FundCheck
/// with the given fields replaced by the non-null parameter values.
@override @pragma('vm:prefer-inline') $Res call({Object? companyId = null,Object? companyCode = freezed,Object? companyName = freezed,Object? enabled = null,Object? applies = null,Object? status = null,Object? blocked = null,Object? blockedText = freezed,Object? balance = null,Object? commitments = null,Object? available = null,Object? needed = null,Object? gap = null,Object? accountCount = null,Object? excludedSiteCount = null,Object? excludedSiteBalance = null,Object? waitingCount = null,Object? waitingAmount = null,Object? commitmentItems = null,Object? loans = null,}) {
  return _then(_FundCheck(
companyId: null == companyId ? _self.companyId : companyId // ignore: cast_nullable_to_non_nullable
as int,companyCode: freezed == companyCode ? _self.companyCode : companyCode // ignore: cast_nullable_to_non_nullable
as String?,companyName: freezed == companyName ? _self.companyName : companyName // ignore: cast_nullable_to_non_nullable
as String?,enabled: null == enabled ? _self.enabled : enabled // ignore: cast_nullable_to_non_nullable
as bool,applies: null == applies ? _self.applies : applies // ignore: cast_nullable_to_non_nullable
as bool,status: null == status ? _self.status : status // ignore: cast_nullable_to_non_nullable
as FundCheckStatus,blocked: null == blocked ? _self.blocked : blocked // ignore: cast_nullable_to_non_nullable
as bool,blockedText: freezed == blockedText ? _self.blockedText : blockedText // ignore: cast_nullable_to_non_nullable
as String?,balance: null == balance ? _self.balance : balance // ignore: cast_nullable_to_non_nullable
as int,commitments: null == commitments ? _self.commitments : commitments // ignore: cast_nullable_to_non_nullable
as int,available: null == available ? _self.available : available // ignore: cast_nullable_to_non_nullable
as int,needed: null == needed ? _self.needed : needed // ignore: cast_nullable_to_non_nullable
as int,gap: null == gap ? _self.gap : gap // ignore: cast_nullable_to_non_nullable
as int,accountCount: null == accountCount ? _self.accountCount : accountCount // ignore: cast_nullable_to_non_nullable
as int,excludedSiteCount: null == excludedSiteCount ? _self.excludedSiteCount : excludedSiteCount // ignore: cast_nullable_to_non_nullable
as int,excludedSiteBalance: null == excludedSiteBalance ? _self.excludedSiteBalance : excludedSiteBalance // ignore: cast_nullable_to_non_nullable
as int,waitingCount: null == waitingCount ? _self.waitingCount : waitingCount // ignore: cast_nullable_to_non_nullable
as int,waitingAmount: null == waitingAmount ? _self.waitingAmount : waitingAmount // ignore: cast_nullable_to_non_nullable
as int,commitmentItems: null == commitmentItems ? _self._commitmentItems : commitmentItems // ignore: cast_nullable_to_non_nullable
as List<FundCommitmentItem>,loans: null == loans ? _self._loans : loans // ignore: cast_nullable_to_non_nullable
as List<FundLoanRef>,
  ));
}


}

// dart format on
