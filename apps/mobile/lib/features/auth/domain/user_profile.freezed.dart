// GENERATED CODE - DO NOT MODIFY BY HAND
// coverage:ignore-file
// ignore_for_file: type=lint, type=warning, deprecated_member_use, deprecated_member_use_from_same_package
// ignore_for_file: unused_element, deprecated_member_use, deprecated_member_use_from_same_package, use_function_type_syntax_for_parameters, unnecessary_const, avoid_init_to_null, invalid_override_different_default_values_named, prefer_expression_function_bodies, annotate_overrides, invalid_annotation_target, unnecessary_question_mark

part of 'user_profile.dart';

// **************************************************************************
// FreezedGenerator
// **************************************************************************

// GENERATED CODE - DO NOT MODIFY BY HAND
// dart format off
T _$identity<T>(T value) => value;
/// @nodoc
mixin _$Capabilities {

/// Direktur (`pk-owner`) or Finance (`pk-finance`): "Persetujuan" inbox.
 bool get approvalInbox;/// PM (`pk-pm`): team list / team dashboard, monitoring only (no decisions).
 bool get teamMonitor;/// E4: PM (team projects) or Direktur (all) may create progress reports; Staff cannot.
 bool get progressReportCreate;
/// Create a copy of Capabilities
/// with the given fields replaced by the non-null parameter values.
@JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$CapabilitiesCopyWith<Capabilities> get copyWith => _$CapabilitiesCopyWithImpl<Capabilities>(this as Capabilities, _$identity);



@override
bool operator ==(Object other) {
  final _this = this as Capabilities;
  return identical(this, other) || (other.runtimeType == runtimeType&&other is Capabilities&&(identical(other.approvalInbox, _this.approvalInbox) || other.approvalInbox == _this.approvalInbox)&&(identical(other.teamMonitor, _this.teamMonitor) || other.teamMonitor == _this.teamMonitor)&&(identical(other.progressReportCreate, _this.progressReportCreate) || other.progressReportCreate == _this.progressReportCreate));
}


@override
int get hashCode {
  final _this = this as Capabilities;
  return Object.hash(runtimeType,_this.approvalInbox,_this.teamMonitor,_this.progressReportCreate);
}

@override
String toString() {
  final _this = this as Capabilities;
  return 'Capabilities(approvalInbox: ${_this.approvalInbox}, teamMonitor: ${_this.teamMonitor}, progressReportCreate: ${_this.progressReportCreate})';
}


}

/// @nodoc
abstract mixin class $CapabilitiesCopyWith<$Res>  {
  factory $CapabilitiesCopyWith(Capabilities value, $Res Function(Capabilities) _then) = _$CapabilitiesCopyWithImpl;
@useResult
$Res call({
 bool approvalInbox, bool teamMonitor, bool progressReportCreate
});




}
/// @nodoc
class _$CapabilitiesCopyWithImpl<$Res>
    implements $CapabilitiesCopyWith<$Res> {
  _$CapabilitiesCopyWithImpl(this._self, this._then);

  final Capabilities _self;
  final $Res Function(Capabilities) _then;

/// Create a copy of Capabilities
/// with the given fields replaced by the non-null parameter values.
@pragma('vm:prefer-inline') @override $Res call({Object? approvalInbox = null,Object? teamMonitor = null,Object? progressReportCreate = null,}) {
  return _then(Capabilities(
approvalInbox: null == approvalInbox ? _self.approvalInbox : approvalInbox // ignore: cast_nullable_to_non_nullable
as bool,teamMonitor: null == teamMonitor ? _self.teamMonitor : teamMonitor // ignore: cast_nullable_to_non_nullable
as bool,progressReportCreate: null == progressReportCreate ? _self.progressReportCreate : progressReportCreate // ignore: cast_nullable_to_non_nullable
as bool,
  ));
}

}


/// Adds pattern-matching-related methods to [Capabilities].
extension CapabilitiesPatterns on Capabilities {
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

@optionalTypeArgs TResult maybeMap<TResult extends Object?>(TResult Function( _Capabilities value)?  $default,{required TResult orElse(),}){
final _that = this;
switch (_that) {
case _Capabilities() when $default != null:
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

@optionalTypeArgs TResult map<TResult extends Object?>(TResult Function( _Capabilities value)  $default,){
final _that = this;
switch (_that) {
case _Capabilities():
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

@optionalTypeArgs TResult? mapOrNull<TResult extends Object?>(TResult? Function( _Capabilities value)?  $default,){
final _that = this;
switch (_that) {
case _Capabilities() when $default != null:
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

@optionalTypeArgs TResult maybeWhen<TResult extends Object?>(TResult Function( bool approvalInbox,  bool teamMonitor,  bool progressReportCreate)?  $default,{required TResult orElse(),}) {final _that = this;
switch (_that) {
case _Capabilities() when $default != null:
return $default(_that.approvalInbox,_that.teamMonitor,_that.progressReportCreate);case _:
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

@optionalTypeArgs TResult when<TResult extends Object?>(TResult Function( bool approvalInbox,  bool teamMonitor,  bool progressReportCreate)  $default,) {final _that = this;
switch (_that) {
case _Capabilities():
return $default(_that.approvalInbox,_that.teamMonitor,_that.progressReportCreate);case _:
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

@optionalTypeArgs TResult? whenOrNull<TResult extends Object?>(TResult? Function( bool approvalInbox,  bool teamMonitor,  bool progressReportCreate)?  $default,) {final _that = this;
switch (_that) {
case _Capabilities() when $default != null:
return $default(_that.approvalInbox,_that.teamMonitor,_that.progressReportCreate);case _:
  return null;

}
}

}

/// @nodoc


class _Capabilities implements Capabilities {
  const _Capabilities({this.approvalInbox = false, this.teamMonitor = false, this.progressReportCreate = false});
  

/// Direktur (`pk-owner`) or Finance (`pk-finance`): "Persetujuan" inbox.
@override@JsonKey() final  bool approvalInbox;
/// PM (`pk-pm`): team list / team dashboard, monitoring only (no decisions).
@override@JsonKey() final  bool teamMonitor;
/// E4: PM (team projects) or Direktur (all) may create progress reports; Staff cannot.
@override@JsonKey() final  bool progressReportCreate;

/// Create a copy of Capabilities
/// with the given fields replaced by the non-null parameter values.
@override @JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
_$CapabilitiesCopyWith<_Capabilities> get copyWith => __$CapabilitiesCopyWithImpl<_Capabilities>(this, _$identity);



@override
bool operator ==(Object other) {
    return identical(this, other) || (other.runtimeType == runtimeType&&other is _Capabilities&&(identical(other.approvalInbox, approvalInbox) || other.approvalInbox == approvalInbox)&&(identical(other.teamMonitor, teamMonitor) || other.teamMonitor == teamMonitor)&&(identical(other.progressReportCreate, progressReportCreate) || other.progressReportCreate == progressReportCreate));
}


@override
int get hashCode {
    return Object.hash(runtimeType,approvalInbox,teamMonitor,progressReportCreate);
}

@override
String toString() {
    return 'Capabilities(approvalInbox: $approvalInbox, teamMonitor: $teamMonitor, progressReportCreate: $progressReportCreate)';
}


}

/// @nodoc
abstract mixin class _$CapabilitiesCopyWith<$Res> implements $CapabilitiesCopyWith<$Res> {
  factory _$CapabilitiesCopyWith(_Capabilities value, $Res Function(_Capabilities) _then) = __$CapabilitiesCopyWithImpl;
@override @useResult
$Res call({
 bool approvalInbox, bool teamMonitor, bool progressReportCreate
});




}
/// @nodoc
class __$CapabilitiesCopyWithImpl<$Res>
    implements _$CapabilitiesCopyWith<$Res> {
  __$CapabilitiesCopyWithImpl(this._self, this._then);

  final _Capabilities _self;
  final $Res Function(_Capabilities) _then;

/// Create a copy of Capabilities
/// with the given fields replaced by the non-null parameter values.
@override @pragma('vm:prefer-inline') $Res call({Object? approvalInbox = null,Object? teamMonitor = null,Object? progressReportCreate = null,}) {
  return _then(_Capabilities(
approvalInbox: null == approvalInbox ? _self.approvalInbox : approvalInbox // ignore: cast_nullable_to_non_nullable
as bool,teamMonitor: null == teamMonitor ? _self.teamMonitor : teamMonitor // ignore: cast_nullable_to_non_nullable
as bool,progressReportCreate: null == progressReportCreate ? _self.progressReportCreate : progressReportCreate // ignore: cast_nullable_to_non_nullable
as bool,
  ));
}


}

/// @nodoc
mixin _$Employee {

 int get id; String get code; String get name;
/// Create a copy of Employee
/// with the given fields replaced by the non-null parameter values.
@JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$EmployeeCopyWith<Employee> get copyWith => _$EmployeeCopyWithImpl<Employee>(this as Employee, _$identity);



@override
bool operator ==(Object other) {
  final _this = this as Employee;
  return identical(this, other) || (other.runtimeType == runtimeType&&other is Employee&&(identical(other.id, _this.id) || other.id == _this.id)&&(identical(other.code, _this.code) || other.code == _this.code)&&(identical(other.name, _this.name) || other.name == _this.name));
}


@override
int get hashCode {
  final _this = this as Employee;
  return Object.hash(runtimeType,_this.id,_this.code,_this.name);
}

@override
String toString() {
  final _this = this as Employee;
  return 'Employee(id: ${_this.id}, code: ${_this.code}, name: ${_this.name})';
}


}

/// @nodoc
abstract mixin class $EmployeeCopyWith<$Res>  {
  factory $EmployeeCopyWith(Employee value, $Res Function(Employee) _then) = _$EmployeeCopyWithImpl;
@useResult
$Res call({
 int id, String code, String name
});




}
/// @nodoc
class _$EmployeeCopyWithImpl<$Res>
    implements $EmployeeCopyWith<$Res> {
  _$EmployeeCopyWithImpl(this._self, this._then);

  final Employee _self;
  final $Res Function(Employee) _then;

/// Create a copy of Employee
/// with the given fields replaced by the non-null parameter values.
@pragma('vm:prefer-inline') @override $Res call({Object? id = null,Object? code = null,Object? name = null,}) {
  return _then(Employee(
id: null == id ? _self.id : id // ignore: cast_nullable_to_non_nullable
as int,code: null == code ? _self.code : code // ignore: cast_nullable_to_non_nullable
as String,name: null == name ? _self.name : name // ignore: cast_nullable_to_non_nullable
as String,
  ));
}

}


/// Adds pattern-matching-related methods to [Employee].
extension EmployeePatterns on Employee {
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

@optionalTypeArgs TResult maybeMap<TResult extends Object?>(TResult Function( _Employee value)?  $default,{required TResult orElse(),}){
final _that = this;
switch (_that) {
case _Employee() when $default != null:
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

@optionalTypeArgs TResult map<TResult extends Object?>(TResult Function( _Employee value)  $default,){
final _that = this;
switch (_that) {
case _Employee():
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

@optionalTypeArgs TResult? mapOrNull<TResult extends Object?>(TResult? Function( _Employee value)?  $default,){
final _that = this;
switch (_that) {
case _Employee() when $default != null:
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

@optionalTypeArgs TResult maybeWhen<TResult extends Object?>(TResult Function( int id,  String code,  String name)?  $default,{required TResult orElse(),}) {final _that = this;
switch (_that) {
case _Employee() when $default != null:
return $default(_that.id,_that.code,_that.name);case _:
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

@optionalTypeArgs TResult when<TResult extends Object?>(TResult Function( int id,  String code,  String name)  $default,) {final _that = this;
switch (_that) {
case _Employee():
return $default(_that.id,_that.code,_that.name);case _:
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

@optionalTypeArgs TResult? whenOrNull<TResult extends Object?>(TResult? Function( int id,  String code,  String name)?  $default,) {final _that = this;
switch (_that) {
case _Employee() when $default != null:
return $default(_that.id,_that.code,_that.name);case _:
  return null;

}
}

}

/// @nodoc


class _Employee implements Employee {
  const _Employee({required this.id, required this.code, required this.name});
  

@override final  int id;
@override final  String code;
@override final  String name;

/// Create a copy of Employee
/// with the given fields replaced by the non-null parameter values.
@override @JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
_$EmployeeCopyWith<_Employee> get copyWith => __$EmployeeCopyWithImpl<_Employee>(this, _$identity);



@override
bool operator ==(Object other) {
    return identical(this, other) || (other.runtimeType == runtimeType&&other is _Employee&&(identical(other.id, id) || other.id == id)&&(identical(other.code, code) || other.code == code)&&(identical(other.name, name) || other.name == name));
}


@override
int get hashCode {
    return Object.hash(runtimeType,id,code,name);
}

@override
String toString() {
    return 'Employee(id: $id, code: $code, name: $name)';
}


}

/// @nodoc
abstract mixin class _$EmployeeCopyWith<$Res> implements $EmployeeCopyWith<$Res> {
  factory _$EmployeeCopyWith(_Employee value, $Res Function(_Employee) _then) = __$EmployeeCopyWithImpl;
@override @useResult
$Res call({
 int id, String code, String name
});




}
/// @nodoc
class __$EmployeeCopyWithImpl<$Res>
    implements _$EmployeeCopyWith<$Res> {
  __$EmployeeCopyWithImpl(this._self, this._then);

  final _Employee _self;
  final $Res Function(_Employee) _then;

/// Create a copy of Employee
/// with the given fields replaced by the non-null parameter values.
@override @pragma('vm:prefer-inline') $Res call({Object? id = null,Object? code = null,Object? name = null,}) {
  return _then(_Employee(
id: null == id ? _self.id : id // ignore: cast_nullable_to_non_nullable
as int,code: null == code ? _self.code : code // ignore: cast_nullable_to_non_nullable
as String,name: null == name ? _self.name : name // ignore: cast_nullable_to_non_nullable
as String,
  ));
}


}

/// @nodoc
mixin _$ImageTargets {

 int get receiptsMaxPx; int get jpegQuality;
/// Create a copy of ImageTargets
/// with the given fields replaced by the non-null parameter values.
@JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$ImageTargetsCopyWith<ImageTargets> get copyWith => _$ImageTargetsCopyWithImpl<ImageTargets>(this as ImageTargets, _$identity);



@override
bool operator ==(Object other) {
  final _this = this as ImageTargets;
  return identical(this, other) || (other.runtimeType == runtimeType&&other is ImageTargets&&(identical(other.receiptsMaxPx, _this.receiptsMaxPx) || other.receiptsMaxPx == _this.receiptsMaxPx)&&(identical(other.jpegQuality, _this.jpegQuality) || other.jpegQuality == _this.jpegQuality));
}


@override
int get hashCode {
  final _this = this as ImageTargets;
  return Object.hash(runtimeType,_this.receiptsMaxPx,_this.jpegQuality);
}

@override
String toString() {
  final _this = this as ImageTargets;
  return 'ImageTargets(receiptsMaxPx: ${_this.receiptsMaxPx}, jpegQuality: ${_this.jpegQuality})';
}


}

/// @nodoc
abstract mixin class $ImageTargetsCopyWith<$Res>  {
  factory $ImageTargetsCopyWith(ImageTargets value, $Res Function(ImageTargets) _then) = _$ImageTargetsCopyWithImpl;
@useResult
$Res call({
 int receiptsMaxPx, int jpegQuality
});




}
/// @nodoc
class _$ImageTargetsCopyWithImpl<$Res>
    implements $ImageTargetsCopyWith<$Res> {
  _$ImageTargetsCopyWithImpl(this._self, this._then);

  final ImageTargets _self;
  final $Res Function(ImageTargets) _then;

/// Create a copy of ImageTargets
/// with the given fields replaced by the non-null parameter values.
@pragma('vm:prefer-inline') @override $Res call({Object? receiptsMaxPx = null,Object? jpegQuality = null,}) {
  return _then(ImageTargets(
receiptsMaxPx: null == receiptsMaxPx ? _self.receiptsMaxPx : receiptsMaxPx // ignore: cast_nullable_to_non_nullable
as int,jpegQuality: null == jpegQuality ? _self.jpegQuality : jpegQuality // ignore: cast_nullable_to_non_nullable
as int,
  ));
}

}


/// Adds pattern-matching-related methods to [ImageTargets].
extension ImageTargetsPatterns on ImageTargets {
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

@optionalTypeArgs TResult maybeMap<TResult extends Object?>(TResult Function( _ImageTargets value)?  $default,{required TResult orElse(),}){
final _that = this;
switch (_that) {
case _ImageTargets() when $default != null:
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

@optionalTypeArgs TResult map<TResult extends Object?>(TResult Function( _ImageTargets value)  $default,){
final _that = this;
switch (_that) {
case _ImageTargets():
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

@optionalTypeArgs TResult? mapOrNull<TResult extends Object?>(TResult? Function( _ImageTargets value)?  $default,){
final _that = this;
switch (_that) {
case _ImageTargets() when $default != null:
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

@optionalTypeArgs TResult maybeWhen<TResult extends Object?>(TResult Function( int receiptsMaxPx,  int jpegQuality)?  $default,{required TResult orElse(),}) {final _that = this;
switch (_that) {
case _ImageTargets() when $default != null:
return $default(_that.receiptsMaxPx,_that.jpegQuality);case _:
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

@optionalTypeArgs TResult when<TResult extends Object?>(TResult Function( int receiptsMaxPx,  int jpegQuality)  $default,) {final _that = this;
switch (_that) {
case _ImageTargets():
return $default(_that.receiptsMaxPx,_that.jpegQuality);case _:
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

@optionalTypeArgs TResult? whenOrNull<TResult extends Object?>(TResult? Function( int receiptsMaxPx,  int jpegQuality)?  $default,) {final _that = this;
switch (_that) {
case _ImageTargets() when $default != null:
return $default(_that.receiptsMaxPx,_that.jpegQuality);case _:
  return null;

}
}

}

/// @nodoc


class _ImageTargets implements ImageTargets {
  const _ImageTargets({this.receiptsMaxPx = 2000, this.jpegQuality = 80});
  

@override@JsonKey() final  int receiptsMaxPx;
@override@JsonKey() final  int jpegQuality;

/// Create a copy of ImageTargets
/// with the given fields replaced by the non-null parameter values.
@override @JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
_$ImageTargetsCopyWith<_ImageTargets> get copyWith => __$ImageTargetsCopyWithImpl<_ImageTargets>(this, _$identity);



@override
bool operator ==(Object other) {
    return identical(this, other) || (other.runtimeType == runtimeType&&other is _ImageTargets&&(identical(other.receiptsMaxPx, receiptsMaxPx) || other.receiptsMaxPx == receiptsMaxPx)&&(identical(other.jpegQuality, jpegQuality) || other.jpegQuality == jpegQuality));
}


@override
int get hashCode {
    return Object.hash(runtimeType,receiptsMaxPx,jpegQuality);
}

@override
String toString() {
    return 'ImageTargets(receiptsMaxPx: $receiptsMaxPx, jpegQuality: $jpegQuality)';
}


}

/// @nodoc
abstract mixin class _$ImageTargetsCopyWith<$Res> implements $ImageTargetsCopyWith<$Res> {
  factory _$ImageTargetsCopyWith(_ImageTargets value, $Res Function(_ImageTargets) _then) = __$ImageTargetsCopyWithImpl;
@override @useResult
$Res call({
 int receiptsMaxPx, int jpegQuality
});




}
/// @nodoc
class __$ImageTargetsCopyWithImpl<$Res>
    implements _$ImageTargetsCopyWith<$Res> {
  __$ImageTargetsCopyWithImpl(this._self, this._then);

  final _ImageTargets _self;
  final $Res Function(_ImageTargets) _then;

/// Create a copy of ImageTargets
/// with the given fields replaced by the non-null parameter values.
@override @pragma('vm:prefer-inline') $Res call({Object? receiptsMaxPx = null,Object? jpegQuality = null,}) {
  return _then(_ImageTargets(
receiptsMaxPx: null == receiptsMaxPx ? _self.receiptsMaxPx : receiptsMaxPx // ignore: cast_nullable_to_non_nullable
as int,jpegQuality: null == jpegQuality ? _self.jpegQuality : jpegQuality // ignore: cast_nullable_to_non_nullable
as int,
  ));
}


}

/// @nodoc
mixin _$CompanySettings {

 int get defaultGeofenceRadiusM; int get receiptRoundingTolerance; int get receiptMaxAgeDays; double get budgetWarnPct; bool get syncExpenseDraftsEnabled; bool get syncAttendanceEnabled; bool get syncProgressReportsEnabled;
/// Create a copy of CompanySettings
/// with the given fields replaced by the non-null parameter values.
@JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$CompanySettingsCopyWith<CompanySettings> get copyWith => _$CompanySettingsCopyWithImpl<CompanySettings>(this as CompanySettings, _$identity);



@override
bool operator ==(Object other) {
  final _this = this as CompanySettings;
  return identical(this, other) || (other.runtimeType == runtimeType&&other is CompanySettings&&(identical(other.defaultGeofenceRadiusM, _this.defaultGeofenceRadiusM) || other.defaultGeofenceRadiusM == _this.defaultGeofenceRadiusM)&&(identical(other.receiptRoundingTolerance, _this.receiptRoundingTolerance) || other.receiptRoundingTolerance == _this.receiptRoundingTolerance)&&(identical(other.receiptMaxAgeDays, _this.receiptMaxAgeDays) || other.receiptMaxAgeDays == _this.receiptMaxAgeDays)&&(identical(other.budgetWarnPct, _this.budgetWarnPct) || other.budgetWarnPct == _this.budgetWarnPct)&&(identical(other.syncExpenseDraftsEnabled, _this.syncExpenseDraftsEnabled) || other.syncExpenseDraftsEnabled == _this.syncExpenseDraftsEnabled)&&(identical(other.syncAttendanceEnabled, _this.syncAttendanceEnabled) || other.syncAttendanceEnabled == _this.syncAttendanceEnabled)&&(identical(other.syncProgressReportsEnabled, _this.syncProgressReportsEnabled) || other.syncProgressReportsEnabled == _this.syncProgressReportsEnabled));
}


@override
int get hashCode {
  final _this = this as CompanySettings;
  return Object.hash(runtimeType,_this.defaultGeofenceRadiusM,_this.receiptRoundingTolerance,_this.receiptMaxAgeDays,_this.budgetWarnPct,_this.syncExpenseDraftsEnabled,_this.syncAttendanceEnabled,_this.syncProgressReportsEnabled);
}

@override
String toString() {
  final _this = this as CompanySettings;
  return 'CompanySettings(defaultGeofenceRadiusM: ${_this.defaultGeofenceRadiusM}, receiptRoundingTolerance: ${_this.receiptRoundingTolerance}, receiptMaxAgeDays: ${_this.receiptMaxAgeDays}, budgetWarnPct: ${_this.budgetWarnPct}, syncExpenseDraftsEnabled: ${_this.syncExpenseDraftsEnabled}, syncAttendanceEnabled: ${_this.syncAttendanceEnabled}, syncProgressReportsEnabled: ${_this.syncProgressReportsEnabled})';
}


}

/// @nodoc
abstract mixin class $CompanySettingsCopyWith<$Res>  {
  factory $CompanySettingsCopyWith(CompanySettings value, $Res Function(CompanySettings) _then) = _$CompanySettingsCopyWithImpl;
@useResult
$Res call({
 int defaultGeofenceRadiusM, int receiptRoundingTolerance, int receiptMaxAgeDays, double budgetWarnPct, bool syncExpenseDraftsEnabled, bool syncAttendanceEnabled, bool syncProgressReportsEnabled
});




}
/// @nodoc
class _$CompanySettingsCopyWithImpl<$Res>
    implements $CompanySettingsCopyWith<$Res> {
  _$CompanySettingsCopyWithImpl(this._self, this._then);

  final CompanySettings _self;
  final $Res Function(CompanySettings) _then;

/// Create a copy of CompanySettings
/// with the given fields replaced by the non-null parameter values.
@pragma('vm:prefer-inline') @override $Res call({Object? defaultGeofenceRadiusM = null,Object? receiptRoundingTolerance = null,Object? receiptMaxAgeDays = null,Object? budgetWarnPct = null,Object? syncExpenseDraftsEnabled = null,Object? syncAttendanceEnabled = null,Object? syncProgressReportsEnabled = null,}) {
  return _then(CompanySettings(
defaultGeofenceRadiusM: null == defaultGeofenceRadiusM ? _self.defaultGeofenceRadiusM : defaultGeofenceRadiusM // ignore: cast_nullable_to_non_nullable
as int,receiptRoundingTolerance: null == receiptRoundingTolerance ? _self.receiptRoundingTolerance : receiptRoundingTolerance // ignore: cast_nullable_to_non_nullable
as int,receiptMaxAgeDays: null == receiptMaxAgeDays ? _self.receiptMaxAgeDays : receiptMaxAgeDays // ignore: cast_nullable_to_non_nullable
as int,budgetWarnPct: null == budgetWarnPct ? _self.budgetWarnPct : budgetWarnPct // ignore: cast_nullable_to_non_nullable
as double,syncExpenseDraftsEnabled: null == syncExpenseDraftsEnabled ? _self.syncExpenseDraftsEnabled : syncExpenseDraftsEnabled // ignore: cast_nullable_to_non_nullable
as bool,syncAttendanceEnabled: null == syncAttendanceEnabled ? _self.syncAttendanceEnabled : syncAttendanceEnabled // ignore: cast_nullable_to_non_nullable
as bool,syncProgressReportsEnabled: null == syncProgressReportsEnabled ? _self.syncProgressReportsEnabled : syncProgressReportsEnabled // ignore: cast_nullable_to_non_nullable
as bool,
  ));
}

}


/// Adds pattern-matching-related methods to [CompanySettings].
extension CompanySettingsPatterns on CompanySettings {
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

@optionalTypeArgs TResult maybeMap<TResult extends Object?>(TResult Function( _CompanySettings value)?  $default,{required TResult orElse(),}){
final _that = this;
switch (_that) {
case _CompanySettings() when $default != null:
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

@optionalTypeArgs TResult map<TResult extends Object?>(TResult Function( _CompanySettings value)  $default,){
final _that = this;
switch (_that) {
case _CompanySettings():
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

@optionalTypeArgs TResult? mapOrNull<TResult extends Object?>(TResult? Function( _CompanySettings value)?  $default,){
final _that = this;
switch (_that) {
case _CompanySettings() when $default != null:
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

@optionalTypeArgs TResult maybeWhen<TResult extends Object?>(TResult Function( int defaultGeofenceRadiusM,  int receiptRoundingTolerance,  int receiptMaxAgeDays,  double budgetWarnPct,  bool syncExpenseDraftsEnabled,  bool syncAttendanceEnabled,  bool syncProgressReportsEnabled)?  $default,{required TResult orElse(),}) {final _that = this;
switch (_that) {
case _CompanySettings() when $default != null:
return $default(_that.defaultGeofenceRadiusM,_that.receiptRoundingTolerance,_that.receiptMaxAgeDays,_that.budgetWarnPct,_that.syncExpenseDraftsEnabled,_that.syncAttendanceEnabled,_that.syncProgressReportsEnabled);case _:
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

@optionalTypeArgs TResult when<TResult extends Object?>(TResult Function( int defaultGeofenceRadiusM,  int receiptRoundingTolerance,  int receiptMaxAgeDays,  double budgetWarnPct,  bool syncExpenseDraftsEnabled,  bool syncAttendanceEnabled,  bool syncProgressReportsEnabled)  $default,) {final _that = this;
switch (_that) {
case _CompanySettings():
return $default(_that.defaultGeofenceRadiusM,_that.receiptRoundingTolerance,_that.receiptMaxAgeDays,_that.budgetWarnPct,_that.syncExpenseDraftsEnabled,_that.syncAttendanceEnabled,_that.syncProgressReportsEnabled);case _:
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

@optionalTypeArgs TResult? whenOrNull<TResult extends Object?>(TResult? Function( int defaultGeofenceRadiusM,  int receiptRoundingTolerance,  int receiptMaxAgeDays,  double budgetWarnPct,  bool syncExpenseDraftsEnabled,  bool syncAttendanceEnabled,  bool syncProgressReportsEnabled)?  $default,) {final _that = this;
switch (_that) {
case _CompanySettings() when $default != null:
return $default(_that.defaultGeofenceRadiusM,_that.receiptRoundingTolerance,_that.receiptMaxAgeDays,_that.budgetWarnPct,_that.syncExpenseDraftsEnabled,_that.syncAttendanceEnabled,_that.syncProgressReportsEnabled);case _:
  return null;

}
}

}

/// @nodoc


class _CompanySettings implements CompanySettings {
  const _CompanySettings({this.defaultGeofenceRadiusM = 100, this.receiptRoundingTolerance = 0, this.receiptMaxAgeDays = 0, this.budgetWarnPct = 85, this.syncExpenseDraftsEnabled = true, this.syncAttendanceEnabled = false, this.syncProgressReportsEnabled = false});
  

@override@JsonKey() final  int defaultGeofenceRadiusM;
@override@JsonKey() final  int receiptRoundingTolerance;
@override@JsonKey() final  int receiptMaxAgeDays;
@override@JsonKey() final  double budgetWarnPct;
@override@JsonKey() final  bool syncExpenseDraftsEnabled;
@override@JsonKey() final  bool syncAttendanceEnabled;
@override@JsonKey() final  bool syncProgressReportsEnabled;

/// Create a copy of CompanySettings
/// with the given fields replaced by the non-null parameter values.
@override @JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
_$CompanySettingsCopyWith<_CompanySettings> get copyWith => __$CompanySettingsCopyWithImpl<_CompanySettings>(this, _$identity);



@override
bool operator ==(Object other) {
    return identical(this, other) || (other.runtimeType == runtimeType&&other is _CompanySettings&&(identical(other.defaultGeofenceRadiusM, defaultGeofenceRadiusM) || other.defaultGeofenceRadiusM == defaultGeofenceRadiusM)&&(identical(other.receiptRoundingTolerance, receiptRoundingTolerance) || other.receiptRoundingTolerance == receiptRoundingTolerance)&&(identical(other.receiptMaxAgeDays, receiptMaxAgeDays) || other.receiptMaxAgeDays == receiptMaxAgeDays)&&(identical(other.budgetWarnPct, budgetWarnPct) || other.budgetWarnPct == budgetWarnPct)&&(identical(other.syncExpenseDraftsEnabled, syncExpenseDraftsEnabled) || other.syncExpenseDraftsEnabled == syncExpenseDraftsEnabled)&&(identical(other.syncAttendanceEnabled, syncAttendanceEnabled) || other.syncAttendanceEnabled == syncAttendanceEnabled)&&(identical(other.syncProgressReportsEnabled, syncProgressReportsEnabled) || other.syncProgressReportsEnabled == syncProgressReportsEnabled));
}


@override
int get hashCode {
    return Object.hash(runtimeType,defaultGeofenceRadiusM,receiptRoundingTolerance,receiptMaxAgeDays,budgetWarnPct,syncExpenseDraftsEnabled,syncAttendanceEnabled,syncProgressReportsEnabled);
}

@override
String toString() {
    return 'CompanySettings(defaultGeofenceRadiusM: $defaultGeofenceRadiusM, receiptRoundingTolerance: $receiptRoundingTolerance, receiptMaxAgeDays: $receiptMaxAgeDays, budgetWarnPct: $budgetWarnPct, syncExpenseDraftsEnabled: $syncExpenseDraftsEnabled, syncAttendanceEnabled: $syncAttendanceEnabled, syncProgressReportsEnabled: $syncProgressReportsEnabled)';
}


}

/// @nodoc
abstract mixin class _$CompanySettingsCopyWith<$Res> implements $CompanySettingsCopyWith<$Res> {
  factory _$CompanySettingsCopyWith(_CompanySettings value, $Res Function(_CompanySettings) _then) = __$CompanySettingsCopyWithImpl;
@override @useResult
$Res call({
 int defaultGeofenceRadiusM, int receiptRoundingTolerance, int receiptMaxAgeDays, double budgetWarnPct, bool syncExpenseDraftsEnabled, bool syncAttendanceEnabled, bool syncProgressReportsEnabled
});




}
/// @nodoc
class __$CompanySettingsCopyWithImpl<$Res>
    implements _$CompanySettingsCopyWith<$Res> {
  __$CompanySettingsCopyWithImpl(this._self, this._then);

  final _CompanySettings _self;
  final $Res Function(_CompanySettings) _then;

/// Create a copy of CompanySettings
/// with the given fields replaced by the non-null parameter values.
@override @pragma('vm:prefer-inline') $Res call({Object? defaultGeofenceRadiusM = null,Object? receiptRoundingTolerance = null,Object? receiptMaxAgeDays = null,Object? budgetWarnPct = null,Object? syncExpenseDraftsEnabled = null,Object? syncAttendanceEnabled = null,Object? syncProgressReportsEnabled = null,}) {
  return _then(_CompanySettings(
defaultGeofenceRadiusM: null == defaultGeofenceRadiusM ? _self.defaultGeofenceRadiusM : defaultGeofenceRadiusM // ignore: cast_nullable_to_non_nullable
as int,receiptRoundingTolerance: null == receiptRoundingTolerance ? _self.receiptRoundingTolerance : receiptRoundingTolerance // ignore: cast_nullable_to_non_nullable
as int,receiptMaxAgeDays: null == receiptMaxAgeDays ? _self.receiptMaxAgeDays : receiptMaxAgeDays // ignore: cast_nullable_to_non_nullable
as int,budgetWarnPct: null == budgetWarnPct ? _self.budgetWarnPct : budgetWarnPct // ignore: cast_nullable_to_non_nullable
as double,syncExpenseDraftsEnabled: null == syncExpenseDraftsEnabled ? _self.syncExpenseDraftsEnabled : syncExpenseDraftsEnabled // ignore: cast_nullable_to_non_nullable
as bool,syncAttendanceEnabled: null == syncAttendanceEnabled ? _self.syncAttendanceEnabled : syncAttendanceEnabled // ignore: cast_nullable_to_non_nullable
as bool,syncProgressReportsEnabled: null == syncProgressReportsEnabled ? _self.syncProgressReportsEnabled : syncProgressReportsEnabled // ignore: cast_nullable_to_non_nullable
as bool,
  ));
}


}

/// @nodoc
mixin _$CompanyMembership {

 int get id;/// PT short code (e.g. `DRMS`), shown on chips.
 String get code; String get name; String get timezone; Set<Role> get roles; Employee? get employee; Capabilities get capabilities; CompanySettings get settings;
/// Create a copy of CompanyMembership
/// with the given fields replaced by the non-null parameter values.
@JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$CompanyMembershipCopyWith<CompanyMembership> get copyWith => _$CompanyMembershipCopyWithImpl<CompanyMembership>(this as CompanyMembership, _$identity);



@override
bool operator ==(Object other) {
  final _this = this as CompanyMembership;
  return identical(this, other) || (other.runtimeType == runtimeType&&other is CompanyMembership&&(identical(other.id, _this.id) || other.id == _this.id)&&(identical(other.code, _this.code) || other.code == _this.code)&&(identical(other.name, _this.name) || other.name == _this.name)&&(identical(other.timezone, _this.timezone) || other.timezone == _this.timezone)&&const DeepCollectionEquality().equals(other.roles, _this.roles)&&(identical(other.employee, _this.employee) || other.employee == _this.employee)&&(identical(other.capabilities, _this.capabilities) || other.capabilities == _this.capabilities)&&(identical(other.settings, _this.settings) || other.settings == _this.settings));
}


@override
int get hashCode {
  final _this = this as CompanyMembership;
  return Object.hash(runtimeType,_this.id,_this.code,_this.name,_this.timezone,const DeepCollectionEquality().hash(_this.roles),_this.employee,_this.capabilities,_this.settings);
}

@override
String toString() {
  final _this = this as CompanyMembership;
  return 'CompanyMembership(id: ${_this.id}, code: ${_this.code}, name: ${_this.name}, timezone: ${_this.timezone}, roles: ${_this.roles}, employee: ${_this.employee}, capabilities: ${_this.capabilities}, settings: ${_this.settings})';
}


}

/// @nodoc
abstract mixin class $CompanyMembershipCopyWith<$Res>  {
  factory $CompanyMembershipCopyWith(CompanyMembership value, $Res Function(CompanyMembership) _then) = _$CompanyMembershipCopyWithImpl;
@useResult
$Res call({
 int id, String code, String name, String timezone, Set<Role> roles, Employee? employee, Capabilities capabilities, CompanySettings settings
});


$EmployeeCopyWith<$Res>? get employee;$CapabilitiesCopyWith<$Res> get capabilities;$CompanySettingsCopyWith<$Res> get settings;

}
/// @nodoc
class _$CompanyMembershipCopyWithImpl<$Res>
    implements $CompanyMembershipCopyWith<$Res> {
  _$CompanyMembershipCopyWithImpl(this._self, this._then);

  final CompanyMembership _self;
  final $Res Function(CompanyMembership) _then;

/// Create a copy of CompanyMembership
/// with the given fields replaced by the non-null parameter values.
@pragma('vm:prefer-inline') @override $Res call({Object? id = null,Object? code = null,Object? name = null,Object? timezone = null,Object? roles = null,Object? employee = freezed,Object? capabilities = null,Object? settings = null,}) {
  return _then(CompanyMembership(
id: null == id ? _self.id : id // ignore: cast_nullable_to_non_nullable
as int,code: null == code ? _self.code : code // ignore: cast_nullable_to_non_nullable
as String,name: null == name ? _self.name : name // ignore: cast_nullable_to_non_nullable
as String,timezone: null == timezone ? _self.timezone : timezone // ignore: cast_nullable_to_non_nullable
as String,roles: null == roles ? _self.roles : roles // ignore: cast_nullable_to_non_nullable
as Set<Role>,employee: freezed == employee ? _self.employee : employee // ignore: cast_nullable_to_non_nullable
as Employee?,capabilities: null == capabilities ? _self.capabilities : capabilities // ignore: cast_nullable_to_non_nullable
as Capabilities,settings: null == settings ? _self.settings : settings // ignore: cast_nullable_to_non_nullable
as CompanySettings,
  ));
}
/// Create a copy of CompanyMembership
/// with the given fields replaced by the non-null parameter values.
@override
@pragma('vm:prefer-inline')
$EmployeeCopyWith<$Res>? get employee {
    if (_self.employee == null) {
    return null;
  }

  return $EmployeeCopyWith<$Res>(_self.employee!, (value) {
    return _then(_self.copyWith(employee: value));
  });
}/// Create a copy of CompanyMembership
/// with the given fields replaced by the non-null parameter values.
@override
@pragma('vm:prefer-inline')
$CapabilitiesCopyWith<$Res> get capabilities {
  
  return $CapabilitiesCopyWith<$Res>(_self.capabilities, (value) {
    return _then(_self.copyWith(capabilities: value));
  });
}/// Create a copy of CompanyMembership
/// with the given fields replaced by the non-null parameter values.
@override
@pragma('vm:prefer-inline')
$CompanySettingsCopyWith<$Res> get settings {
  
  return $CompanySettingsCopyWith<$Res>(_self.settings, (value) {
    return _then(_self.copyWith(settings: value));
  });
}
}


/// Adds pattern-matching-related methods to [CompanyMembership].
extension CompanyMembershipPatterns on CompanyMembership {
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

@optionalTypeArgs TResult maybeMap<TResult extends Object?>(TResult Function( _CompanyMembership value)?  $default,{required TResult orElse(),}){
final _that = this;
switch (_that) {
case _CompanyMembership() when $default != null:
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

@optionalTypeArgs TResult map<TResult extends Object?>(TResult Function( _CompanyMembership value)  $default,){
final _that = this;
switch (_that) {
case _CompanyMembership():
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

@optionalTypeArgs TResult? mapOrNull<TResult extends Object?>(TResult? Function( _CompanyMembership value)?  $default,){
final _that = this;
switch (_that) {
case _CompanyMembership() when $default != null:
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

@optionalTypeArgs TResult maybeWhen<TResult extends Object?>(TResult Function( int id,  String code,  String name,  String timezone,  Set<Role> roles,  Employee? employee,  Capabilities capabilities,  CompanySettings settings)?  $default,{required TResult orElse(),}) {final _that = this;
switch (_that) {
case _CompanyMembership() when $default != null:
return $default(_that.id,_that.code,_that.name,_that.timezone,_that.roles,_that.employee,_that.capabilities,_that.settings);case _:
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

@optionalTypeArgs TResult when<TResult extends Object?>(TResult Function( int id,  String code,  String name,  String timezone,  Set<Role> roles,  Employee? employee,  Capabilities capabilities,  CompanySettings settings)  $default,) {final _that = this;
switch (_that) {
case _CompanyMembership():
return $default(_that.id,_that.code,_that.name,_that.timezone,_that.roles,_that.employee,_that.capabilities,_that.settings);case _:
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

@optionalTypeArgs TResult? whenOrNull<TResult extends Object?>(TResult? Function( int id,  String code,  String name,  String timezone,  Set<Role> roles,  Employee? employee,  Capabilities capabilities,  CompanySettings settings)?  $default,) {final _that = this;
switch (_that) {
case _CompanyMembership() when $default != null:
return $default(_that.id,_that.code,_that.name,_that.timezone,_that.roles,_that.employee,_that.capabilities,_that.settings);case _:
  return null;

}
}

}

/// @nodoc


class _CompanyMembership extends CompanyMembership {
  const _CompanyMembership({required this.id, required this.code, required this.name, this.timezone = 'Asia/Makassar',  Set<Role> roles = const <Role>{}, this.employee, this.capabilities = const Capabilities(), this.settings = const CompanySettings()}): _roles = roles,super._();
  

@override final  int id;
/// PT short code (e.g. `DRMS`), shown on chips.
@override final  String code;
@override final  String name;
@override@JsonKey() final  String timezone;
 final  Set<Role> _roles;
@override@JsonKey() Set<Role> get roles {
  if (_roles is EqualUnmodifiableSetView) return _roles;
  // ignore: implicit_dynamic_type
  return EqualUnmodifiableSetView(_roles);
}

@override final  Employee? employee;
@override@JsonKey() final  Capabilities capabilities;
@override@JsonKey() final  CompanySettings settings;

/// Create a copy of CompanyMembership
/// with the given fields replaced by the non-null parameter values.
@override @JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
_$CompanyMembershipCopyWith<_CompanyMembership> get copyWith => __$CompanyMembershipCopyWithImpl<_CompanyMembership>(this, _$identity);



@override
bool operator ==(Object other) {
    return identical(this, other) || (other.runtimeType == runtimeType&&other is _CompanyMembership&&(identical(other.id, id) || other.id == id)&&(identical(other.code, code) || other.code == code)&&(identical(other.name, name) || other.name == name)&&(identical(other.timezone, timezone) || other.timezone == timezone)&&const DeepCollectionEquality().equals(other.roles, _roles)&&(identical(other.employee, employee) || other.employee == employee)&&(identical(other.capabilities, capabilities) || other.capabilities == capabilities)&&(identical(other.settings, settings) || other.settings == settings));
}


@override
int get hashCode {
    return Object.hash(runtimeType,id,code,name,timezone,const DeepCollectionEquality().hash(_roles),employee,capabilities,settings);
}

@override
String toString() {
    return 'CompanyMembership(id: $id, code: $code, name: $name, timezone: $timezone, roles: $roles, employee: $employee, capabilities: $capabilities, settings: $settings)';
}


}

/// @nodoc
abstract mixin class _$CompanyMembershipCopyWith<$Res> implements $CompanyMembershipCopyWith<$Res> {
  factory _$CompanyMembershipCopyWith(_CompanyMembership value, $Res Function(_CompanyMembership) _then) = __$CompanyMembershipCopyWithImpl;
@override @useResult
$Res call({
 int id, String code, String name, String timezone, Set<Role> roles, Employee? employee, Capabilities capabilities, CompanySettings settings
});


@override $EmployeeCopyWith<$Res>? get employee;@override $CapabilitiesCopyWith<$Res> get capabilities;@override $CompanySettingsCopyWith<$Res> get settings;

}
/// @nodoc
class __$CompanyMembershipCopyWithImpl<$Res>
    implements _$CompanyMembershipCopyWith<$Res> {
  __$CompanyMembershipCopyWithImpl(this._self, this._then);

  final _CompanyMembership _self;
  final $Res Function(_CompanyMembership) _then;

/// Create a copy of CompanyMembership
/// with the given fields replaced by the non-null parameter values.
@override @pragma('vm:prefer-inline') $Res call({Object? id = null,Object? code = null,Object? name = null,Object? timezone = null,Object? roles = null,Object? employee = freezed,Object? capabilities = null,Object? settings = null,}) {
  return _then(_CompanyMembership(
id: null == id ? _self.id : id // ignore: cast_nullable_to_non_nullable
as int,code: null == code ? _self.code : code // ignore: cast_nullable_to_non_nullable
as String,name: null == name ? _self.name : name // ignore: cast_nullable_to_non_nullable
as String,timezone: null == timezone ? _self.timezone : timezone // ignore: cast_nullable_to_non_nullable
as String,roles: null == roles ? _self._roles : roles // ignore: cast_nullable_to_non_nullable
as Set<Role>,employee: freezed == employee ? _self.employee : employee // ignore: cast_nullable_to_non_nullable
as Employee?,capabilities: null == capabilities ? _self.capabilities : capabilities // ignore: cast_nullable_to_non_nullable
as Capabilities,settings: null == settings ? _self.settings : settings // ignore: cast_nullable_to_non_nullable
as CompanySettings,
  ));
}

/// Create a copy of CompanyMembership
/// with the given fields replaced by the non-null parameter values.
@override
@pragma('vm:prefer-inline')
$EmployeeCopyWith<$Res>? get employee {
    if (_self.employee == null) {
    return null;
  }

  return $EmployeeCopyWith<$Res>(_self.employee!, (value) {
    return _then(_self.copyWith(employee: value));
  });
}/// Create a copy of CompanyMembership
/// with the given fields replaced by the non-null parameter values.
@override
@pragma('vm:prefer-inline')
$CapabilitiesCopyWith<$Res> get capabilities {
  
  return $CapabilitiesCopyWith<$Res>(_self.capabilities, (value) {
    return _then(_self.copyWith(capabilities: value));
  });
}/// Create a copy of CompanyMembership
/// with the given fields replaced by the non-null parameter values.
@override
@pragma('vm:prefer-inline')
$CompanySettingsCopyWith<$Res> get settings {
  
  return $CompanySettingsCopyWith<$Res>(_self.settings, (value) {
    return _then(_self.copyWith(settings: value));
  });
}
}

/// @nodoc
mixin _$UserProfile {

 int get id; String get email; String? get name; Set<Role> get roles; Capabilities get capabilities; Employee? get employee; String get timezone; String? get minAppVersion; ImageTargets get imageTargets; String? get serverTime;/// MC3: every active membership (ascending id). Empty = server before MC3 (single-PT behaviour).
 List<CompanyMembership> get companies;/// MC3: ids of the PTs the top-level fields were computed for ([scopedTo]); empty = not scoped.
 List<int> get scopeCompanyIds;
/// Create a copy of UserProfile
/// with the given fields replaced by the non-null parameter values.
@JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$UserProfileCopyWith<UserProfile> get copyWith => _$UserProfileCopyWithImpl<UserProfile>(this as UserProfile, _$identity);



@override
bool operator ==(Object other) {
  final _this = this as UserProfile;
  return identical(this, other) || (other.runtimeType == runtimeType&&other is UserProfile&&(identical(other.id, _this.id) || other.id == _this.id)&&(identical(other.email, _this.email) || other.email == _this.email)&&(identical(other.name, _this.name) || other.name == _this.name)&&const DeepCollectionEquality().equals(other.roles, _this.roles)&&(identical(other.capabilities, _this.capabilities) || other.capabilities == _this.capabilities)&&(identical(other.employee, _this.employee) || other.employee == _this.employee)&&(identical(other.timezone, _this.timezone) || other.timezone == _this.timezone)&&(identical(other.minAppVersion, _this.minAppVersion) || other.minAppVersion == _this.minAppVersion)&&(identical(other.imageTargets, _this.imageTargets) || other.imageTargets == _this.imageTargets)&&(identical(other.serverTime, _this.serverTime) || other.serverTime == _this.serverTime)&&const DeepCollectionEquality().equals(other.companies, _this.companies)&&const DeepCollectionEquality().equals(other.scopeCompanyIds, _this.scopeCompanyIds));
}


@override
int get hashCode {
  final _this = this as UserProfile;
  return Object.hash(runtimeType,_this.id,_this.email,_this.name,const DeepCollectionEquality().hash(_this.roles),_this.capabilities,_this.employee,_this.timezone,_this.minAppVersion,_this.imageTargets,_this.serverTime,const DeepCollectionEquality().hash(_this.companies),const DeepCollectionEquality().hash(_this.scopeCompanyIds));
}

@override
String toString() {
  final _this = this as UserProfile;
  return 'UserProfile(id: ${_this.id}, email: ${_this.email}, name: ${_this.name}, roles: ${_this.roles}, capabilities: ${_this.capabilities}, employee: ${_this.employee}, timezone: ${_this.timezone}, minAppVersion: ${_this.minAppVersion}, imageTargets: ${_this.imageTargets}, serverTime: ${_this.serverTime}, companies: ${_this.companies}, scopeCompanyIds: ${_this.scopeCompanyIds})';
}


}

/// @nodoc
abstract mixin class $UserProfileCopyWith<$Res>  {
  factory $UserProfileCopyWith(UserProfile value, $Res Function(UserProfile) _then) = _$UserProfileCopyWithImpl;
@useResult
$Res call({
 int id, String email, String? name, Set<Role> roles, Capabilities capabilities, Employee? employee, String timezone, String? minAppVersion, ImageTargets imageTargets, String? serverTime, List<CompanyMembership> companies, List<int> scopeCompanyIds
});


$CapabilitiesCopyWith<$Res> get capabilities;$EmployeeCopyWith<$Res>? get employee;$ImageTargetsCopyWith<$Res> get imageTargets;

}
/// @nodoc
class _$UserProfileCopyWithImpl<$Res>
    implements $UserProfileCopyWith<$Res> {
  _$UserProfileCopyWithImpl(this._self, this._then);

  final UserProfile _self;
  final $Res Function(UserProfile) _then;

/// Create a copy of UserProfile
/// with the given fields replaced by the non-null parameter values.
@pragma('vm:prefer-inline') @override $Res call({Object? id = null,Object? email = null,Object? name = freezed,Object? roles = null,Object? capabilities = null,Object? employee = freezed,Object? timezone = null,Object? minAppVersion = freezed,Object? imageTargets = null,Object? serverTime = freezed,Object? companies = null,Object? scopeCompanyIds = null,}) {
  return _then(UserProfile(
id: null == id ? _self.id : id // ignore: cast_nullable_to_non_nullable
as int,email: null == email ? _self.email : email // ignore: cast_nullable_to_non_nullable
as String,name: freezed == name ? _self.name : name // ignore: cast_nullable_to_non_nullable
as String?,roles: null == roles ? _self.roles : roles // ignore: cast_nullable_to_non_nullable
as Set<Role>,capabilities: null == capabilities ? _self.capabilities : capabilities // ignore: cast_nullable_to_non_nullable
as Capabilities,employee: freezed == employee ? _self.employee : employee // ignore: cast_nullable_to_non_nullable
as Employee?,timezone: null == timezone ? _self.timezone : timezone // ignore: cast_nullable_to_non_nullable
as String,minAppVersion: freezed == minAppVersion ? _self.minAppVersion : minAppVersion // ignore: cast_nullable_to_non_nullable
as String?,imageTargets: null == imageTargets ? _self.imageTargets : imageTargets // ignore: cast_nullable_to_non_nullable
as ImageTargets,serverTime: freezed == serverTime ? _self.serverTime : serverTime // ignore: cast_nullable_to_non_nullable
as String?,companies: null == companies ? _self.companies : companies // ignore: cast_nullable_to_non_nullable
as List<CompanyMembership>,scopeCompanyIds: null == scopeCompanyIds ? _self.scopeCompanyIds : scopeCompanyIds // ignore: cast_nullable_to_non_nullable
as List<int>,
  ));
}
/// Create a copy of UserProfile
/// with the given fields replaced by the non-null parameter values.
@override
@pragma('vm:prefer-inline')
$CapabilitiesCopyWith<$Res> get capabilities {
  
  return $CapabilitiesCopyWith<$Res>(_self.capabilities, (value) {
    return _then(_self.copyWith(capabilities: value));
  });
}/// Create a copy of UserProfile
/// with the given fields replaced by the non-null parameter values.
@override
@pragma('vm:prefer-inline')
$EmployeeCopyWith<$Res>? get employee {
    if (_self.employee == null) {
    return null;
  }

  return $EmployeeCopyWith<$Res>(_self.employee!, (value) {
    return _then(_self.copyWith(employee: value));
  });
}/// Create a copy of UserProfile
/// with the given fields replaced by the non-null parameter values.
@override
@pragma('vm:prefer-inline')
$ImageTargetsCopyWith<$Res> get imageTargets {
  
  return $ImageTargetsCopyWith<$Res>(_self.imageTargets, (value) {
    return _then(_self.copyWith(imageTargets: value));
  });
}
}


/// Adds pattern-matching-related methods to [UserProfile].
extension UserProfilePatterns on UserProfile {
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

@optionalTypeArgs TResult maybeMap<TResult extends Object?>(TResult Function( _UserProfile value)?  $default,{required TResult orElse(),}){
final _that = this;
switch (_that) {
case _UserProfile() when $default != null:
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

@optionalTypeArgs TResult map<TResult extends Object?>(TResult Function( _UserProfile value)  $default,){
final _that = this;
switch (_that) {
case _UserProfile():
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

@optionalTypeArgs TResult? mapOrNull<TResult extends Object?>(TResult? Function( _UserProfile value)?  $default,){
final _that = this;
switch (_that) {
case _UserProfile() when $default != null:
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

@optionalTypeArgs TResult maybeWhen<TResult extends Object?>(TResult Function( int id,  String email,  String? name,  Set<Role> roles,  Capabilities capabilities,  Employee? employee,  String timezone,  String? minAppVersion,  ImageTargets imageTargets,  String? serverTime,  List<CompanyMembership> companies,  List<int> scopeCompanyIds)?  $default,{required TResult orElse(),}) {final _that = this;
switch (_that) {
case _UserProfile() when $default != null:
return $default(_that.id,_that.email,_that.name,_that.roles,_that.capabilities,_that.employee,_that.timezone,_that.minAppVersion,_that.imageTargets,_that.serverTime,_that.companies,_that.scopeCompanyIds);case _:
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

@optionalTypeArgs TResult when<TResult extends Object?>(TResult Function( int id,  String email,  String? name,  Set<Role> roles,  Capabilities capabilities,  Employee? employee,  String timezone,  String? minAppVersion,  ImageTargets imageTargets,  String? serverTime,  List<CompanyMembership> companies,  List<int> scopeCompanyIds)  $default,) {final _that = this;
switch (_that) {
case _UserProfile():
return $default(_that.id,_that.email,_that.name,_that.roles,_that.capabilities,_that.employee,_that.timezone,_that.minAppVersion,_that.imageTargets,_that.serverTime,_that.companies,_that.scopeCompanyIds);case _:
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

@optionalTypeArgs TResult? whenOrNull<TResult extends Object?>(TResult? Function( int id,  String email,  String? name,  Set<Role> roles,  Capabilities capabilities,  Employee? employee,  String timezone,  String? minAppVersion,  ImageTargets imageTargets,  String? serverTime,  List<CompanyMembership> companies,  List<int> scopeCompanyIds)?  $default,) {final _that = this;
switch (_that) {
case _UserProfile() when $default != null:
return $default(_that.id,_that.email,_that.name,_that.roles,_that.capabilities,_that.employee,_that.timezone,_that.minAppVersion,_that.imageTargets,_that.serverTime,_that.companies,_that.scopeCompanyIds);case _:
  return null;

}
}

}

/// @nodoc


class _UserProfile extends UserProfile {
  const _UserProfile({required this.id, required this.email, this.name, required  Set<Role> roles, this.capabilities = const Capabilities(), this.employee, this.timezone = 'Asia/Makassar', this.minAppVersion, this.imageTargets = const ImageTargets(), this.serverTime,  List<CompanyMembership> companies = const <CompanyMembership>[],  List<int> scopeCompanyIds = const <int>[]}): _roles = roles,_companies = companies,_scopeCompanyIds = scopeCompanyIds,super._();
  

@override final  int id;
@override final  String email;
@override final  String? name;
 final  Set<Role> _roles;
@override Set<Role> get roles {
  if (_roles is EqualUnmodifiableSetView) return _roles;
  // ignore: implicit_dynamic_type
  return EqualUnmodifiableSetView(_roles);
}

@override@JsonKey() final  Capabilities capabilities;
@override final  Employee? employee;
@override@JsonKey() final  String timezone;
@override final  String? minAppVersion;
@override@JsonKey() final  ImageTargets imageTargets;
@override final  String? serverTime;
/// MC3: every active membership (ascending id). Empty = server before MC3 (single-PT behaviour).
 final  List<CompanyMembership> _companies;
/// MC3: every active membership (ascending id). Empty = server before MC3 (single-PT behaviour).
@override@JsonKey() List<CompanyMembership> get companies {
  if (_companies is EqualUnmodifiableListView) return _companies;
  // ignore: implicit_dynamic_type
  return EqualUnmodifiableListView(_companies);
}

/// MC3: ids of the PTs the top-level fields were computed for ([scopedTo]); empty = not scoped.
 final  List<int> _scopeCompanyIds;
/// MC3: ids of the PTs the top-level fields were computed for ([scopedTo]); empty = not scoped.
@override@JsonKey() List<int> get scopeCompanyIds {
  if (_scopeCompanyIds is EqualUnmodifiableListView) return _scopeCompanyIds;
  // ignore: implicit_dynamic_type
  return EqualUnmodifiableListView(_scopeCompanyIds);
}


/// Create a copy of UserProfile
/// with the given fields replaced by the non-null parameter values.
@override @JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
_$UserProfileCopyWith<_UserProfile> get copyWith => __$UserProfileCopyWithImpl<_UserProfile>(this, _$identity);



@override
bool operator ==(Object other) {
    return identical(this, other) || (other.runtimeType == runtimeType&&other is _UserProfile&&(identical(other.id, id) || other.id == id)&&(identical(other.email, email) || other.email == email)&&(identical(other.name, name) || other.name == name)&&const DeepCollectionEquality().equals(other.roles, _roles)&&(identical(other.capabilities, capabilities) || other.capabilities == capabilities)&&(identical(other.employee, employee) || other.employee == employee)&&(identical(other.timezone, timezone) || other.timezone == timezone)&&(identical(other.minAppVersion, minAppVersion) || other.minAppVersion == minAppVersion)&&(identical(other.imageTargets, imageTargets) || other.imageTargets == imageTargets)&&(identical(other.serverTime, serverTime) || other.serverTime == serverTime)&&const DeepCollectionEquality().equals(other.companies, _companies)&&const DeepCollectionEquality().equals(other.scopeCompanyIds, _scopeCompanyIds));
}


@override
int get hashCode {
    return Object.hash(runtimeType,id,email,name,const DeepCollectionEquality().hash(_roles),capabilities,employee,timezone,minAppVersion,imageTargets,serverTime,const DeepCollectionEquality().hash(_companies),const DeepCollectionEquality().hash(_scopeCompanyIds));
}

@override
String toString() {
    return 'UserProfile(id: $id, email: $email, name: $name, roles: $roles, capabilities: $capabilities, employee: $employee, timezone: $timezone, minAppVersion: $minAppVersion, imageTargets: $imageTargets, serverTime: $serverTime, companies: $companies, scopeCompanyIds: $scopeCompanyIds)';
}


}

/// @nodoc
abstract mixin class _$UserProfileCopyWith<$Res> implements $UserProfileCopyWith<$Res> {
  factory _$UserProfileCopyWith(_UserProfile value, $Res Function(_UserProfile) _then) = __$UserProfileCopyWithImpl;
@override @useResult
$Res call({
 int id, String email, String? name, Set<Role> roles, Capabilities capabilities, Employee? employee, String timezone, String? minAppVersion, ImageTargets imageTargets, String? serverTime, List<CompanyMembership> companies, List<int> scopeCompanyIds
});


@override $CapabilitiesCopyWith<$Res> get capabilities;@override $EmployeeCopyWith<$Res>? get employee;@override $ImageTargetsCopyWith<$Res> get imageTargets;

}
/// @nodoc
class __$UserProfileCopyWithImpl<$Res>
    implements _$UserProfileCopyWith<$Res> {
  __$UserProfileCopyWithImpl(this._self, this._then);

  final _UserProfile _self;
  final $Res Function(_UserProfile) _then;

/// Create a copy of UserProfile
/// with the given fields replaced by the non-null parameter values.
@override @pragma('vm:prefer-inline') $Res call({Object? id = null,Object? email = null,Object? name = freezed,Object? roles = null,Object? capabilities = null,Object? employee = freezed,Object? timezone = null,Object? minAppVersion = freezed,Object? imageTargets = null,Object? serverTime = freezed,Object? companies = null,Object? scopeCompanyIds = null,}) {
  return _then(_UserProfile(
id: null == id ? _self.id : id // ignore: cast_nullable_to_non_nullable
as int,email: null == email ? _self.email : email // ignore: cast_nullable_to_non_nullable
as String,name: freezed == name ? _self.name : name // ignore: cast_nullable_to_non_nullable
as String?,roles: null == roles ? _self._roles : roles // ignore: cast_nullable_to_non_nullable
as Set<Role>,capabilities: null == capabilities ? _self.capabilities : capabilities // ignore: cast_nullable_to_non_nullable
as Capabilities,employee: freezed == employee ? _self.employee : employee // ignore: cast_nullable_to_non_nullable
as Employee?,timezone: null == timezone ? _self.timezone : timezone // ignore: cast_nullable_to_non_nullable
as String,minAppVersion: freezed == minAppVersion ? _self.minAppVersion : minAppVersion // ignore: cast_nullable_to_non_nullable
as String?,imageTargets: null == imageTargets ? _self.imageTargets : imageTargets // ignore: cast_nullable_to_non_nullable
as ImageTargets,serverTime: freezed == serverTime ? _self.serverTime : serverTime // ignore: cast_nullable_to_non_nullable
as String?,companies: null == companies ? _self._companies : companies // ignore: cast_nullable_to_non_nullable
as List<CompanyMembership>,scopeCompanyIds: null == scopeCompanyIds ? _self._scopeCompanyIds : scopeCompanyIds // ignore: cast_nullable_to_non_nullable
as List<int>,
  ));
}

/// Create a copy of UserProfile
/// with the given fields replaced by the non-null parameter values.
@override
@pragma('vm:prefer-inline')
$CapabilitiesCopyWith<$Res> get capabilities {
  
  return $CapabilitiesCopyWith<$Res>(_self.capabilities, (value) {
    return _then(_self.copyWith(capabilities: value));
  });
}/// Create a copy of UserProfile
/// with the given fields replaced by the non-null parameter values.
@override
@pragma('vm:prefer-inline')
$EmployeeCopyWith<$Res>? get employee {
    if (_self.employee == null) {
    return null;
  }

  return $EmployeeCopyWith<$Res>(_self.employee!, (value) {
    return _then(_self.copyWith(employee: value));
  });
}/// Create a copy of UserProfile
/// with the given fields replaced by the non-null parameter values.
@override
@pragma('vm:prefer-inline')
$ImageTargetsCopyWith<$Res> get imageTargets {
  
  return $ImageTargetsCopyWith<$Res>(_self.imageTargets, (value) {
    return _then(_self.copyWith(imageTargets: value));
  });
}
}

// dart format on
