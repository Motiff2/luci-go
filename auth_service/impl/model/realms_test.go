// Copyright 2021 The LUCI Authors.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

package model

import (
	"context"
	"testing"

	"google.golang.org/protobuf/proto"

	"go.chromium.org/luci/server/auth/service/protocol"

	"go.chromium.org/luci/auth_service/internal/permissions"

	. "github.com/smartystreets/goconvey/convey"
	. "go.chromium.org/luci/common/testing/assertions"
)

// makeTestPermissions creates permissions with the given permission
// names for testing.
func makeTestPermissions(names ...string) []*protocol.Permission {
	perms := make([]*protocol.Permission, len(names))
	for i, name := range names {
		perms[i] = &protocol.Permission{Name: name}
	}
	return perms
}

// makeTestConditions creates conditions with the given attribute names
// for testing.
func makeTestConditions(names ...string) []*protocol.Condition {
	conds := make([]*protocol.Condition, len(names))
	for i, name := range names {
		conds[i] = &protocol.Condition{
			Op: &protocol.Condition_Restrict{
				Restrict: &protocol.Condition_AttributeRestriction{
					Attribute: name,
					Values:    []string{"x", "y", "z"},
				},
			},
		}
	}
	return conds
}

func TestGetGlobalPermissions(t *testing.T) {
	t.Parallel()

	Convey("Global permissions extracted correctly", t, func() {
		ctx := context.Background()
		// Approximate of how Python stores permissions.
		testV1Perms := makeTestPermissions("perms.v1.a", "perms.v1.b", "perms.v1.c")
		testV1StoredPerms := make([]string, len(testV1Perms))
		for i, perm := range testV1Perms {
			storedPerm, err := proto.Marshal(perm)
			So(err, ShouldBeNil)
			testV1StoredPerms[i] = string(storedPerm)
		}

		testV2Perms := makeTestPermissions("perms.v2.x", "perms.v2.y", "perms.v2.z")
		realmsGlobals := &AuthRealmsGlobals{
			Permissions: testV1StoredPerms,
			PermissionsList: &permissions.PermissionsList{
				Permissions: testV2Perms,
			},
		}

		Convey("gets v1 permissions", func() {
			actual, err := getGlobalPermissions(ctx, realmsGlobals, true)
			So(err, ShouldBeNil)
			So(actual, ShouldResembleProto, testV1Perms)
		})

		Convey("gets v2 permissions", func() {
			actual, err := getGlobalPermissions(ctx, realmsGlobals, false)
			So(err, ShouldBeNil)
			So(actual, ShouldResembleProto, testV2Perms)
		})

		Convey("falls back to v1 permissions when getting v2", func() {
			bareRealmsGlobals := &AuthRealmsGlobals{
				Permissions: testV1StoredPerms,
			}
			actual, err := getGlobalPermissions(ctx, bareRealmsGlobals, false)
			So(err, ShouldBeNil)
			So(actual, ShouldResembleProto, testV1Perms)

			emptyRealmsGlobals := &AuthRealmsGlobals{
				Permissions: testV1StoredPerms,
				PermissionsList: &permissions.PermissionsList{
					Permissions: []*protocol.Permission{},
				},
			}
			actual, err = getGlobalPermissions(ctx, emptyRealmsGlobals, false)
			So(err, ShouldBeNil)
			So(actual, ShouldResembleProto, testV1Perms)
		})

		Convey("returns empty slice", func() {
			actual, err := getGlobalPermissions(ctx, &AuthRealmsGlobals{}, false)
			So(err, ShouldBeNil)
			So(actual, ShouldBeEmpty)

			actual, err = getGlobalPermissions(ctx, &AuthRealmsGlobals{}, true)
			So(err, ShouldBeNil)
			So(actual, ShouldBeEmpty)
		})
	})
}

func TestMergeRealms(t *testing.T) {
	t.Parallel()

	Convey("Merging realms", t, func() {
		ctx := context.Background()

		Convey("empty permissions and project realms", func() {
			realmsGlobals := &AuthRealmsGlobals{
				PermissionsList: &permissions.PermissionsList{
					Permissions: makeTestPermissions(),
				},
			}
			projectRealms := []*AuthProjectRealms{}
			merged, err := MergeRealms(ctx, realmsGlobals, projectRealms, false)
			So(err, ShouldBeNil)
			So(merged, ShouldResembleProto, &protocol.Realms{
				ApiVersion:  RealmsAPIVersion,
				Permissions: []*protocol.Permission{},
				Realms:      []*protocol.Realm{},
			})
		})

		Convey("permissions are remapped", func() {
			proj1Realms := &protocol.Realms{
				Permissions: makeTestPermissions("luci.dev.p2", "luci.dev.z", "luci.dev.p1"),
				Realms: []*protocol.Realm{
					{
						Name: "proj1:@root",
						Bindings: []*protocol.Binding{
							{
								// Permissions p2, z, p1.
								Permissions: []uint32{0, 1, 2},
								Principals:  []string{"group:gr1"},
							},
							{
								// Permission z only; should be dropped.
								Permissions: []uint32{1},
								Principals:  []string{"group:gr2"},
							},
							{
								// Permission p1.
								Permissions: []uint32{2},
								Principals:  []string{"group:gr3"},
							},
						},
					},
				},
			}
			blob, err := ToStorableRealms(proj1Realms)
			So(err, ShouldBeNil)
			projectRealms := []*AuthProjectRealms{
				{ID: "proj1", Realms: blob},
			}

			expectedRealms := &protocol.Realms{
				ApiVersion:  RealmsAPIVersion,
				Permissions: makeTestPermissions("luci.dev.p1", "luci.dev.p2"),
				Realms: []*protocol.Realm{
					{
						Name: "proj1:@root",
						Bindings: []*protocol.Binding{
							{
								// Permission p1.
								Permissions: []uint32{0},
								Principals:  []string{"group:gr3"},
							},
							{
								// Permissions p1, p2.
								Permissions: []uint32{0, 1},
								Principals:  []string{"group:gr1"},
							},
						},
					},
				},
			}

			Convey("when using PermissionsList", func() {
				realmsGlobals := &AuthRealmsGlobals{
					PermissionsList: &permissions.PermissionsList{
						Permissions: makeTestPermissions("luci.dev.p1", "luci.dev.p2"),
					},
				}

				merged, err := MergeRealms(ctx, realmsGlobals, projectRealms, false)
				So(err, ShouldBeNil)
				So(merged, ShouldResembleProto, expectedRealms)
			})

			Convey("when using Permissions", func() {
				luciDevP1, err := proto.Marshal(&protocol.Permission{
					Name: "luci.dev.p1",
				})
				So(err, ShouldBeNil)
				luciDevP2, err := proto.Marshal(&protocol.Permission{
					Name: "luci.dev.p2",
				})
				So(err, ShouldBeNil)
				realmsGlobals := &AuthRealmsGlobals{
					Permissions: []string{string(luciDevP1), string(luciDevP2)},
				}

				merged, err := MergeRealms(ctx, realmsGlobals, projectRealms, true)
				So(err, ShouldBeNil)
				So(merged, ShouldResembleProto, expectedRealms)
			})
		})

		Convey("conditions are remapped", func() {
			realmsGlobals := &AuthRealmsGlobals{
				PermissionsList: &permissions.PermissionsList{
					Permissions: makeTestPermissions("luci.dev.p1"),
				},
			}

			// Set up project realms.
			proj1Realms := &protocol.Realms{
				Permissions: makeTestPermissions("luci.dev.p1"),
				Conditions:  makeTestConditions("a", "b"),
				Realms: []*protocol.Realm{
					{
						Name: "proj1:@root",
						Bindings: []*protocol.Binding{
							{
								Permissions: []uint32{0},
								Conditions:  []uint32{0, 1},
								Principals:  []string{"group:gr1"},
							},
						},
					},
				},
			}
			blob1, err := ToStorableRealms(proj1Realms)
			So(err, ShouldBeNil)
			proj2Realms := &protocol.Realms{
				Permissions: makeTestPermissions("luci.dev.p1"),
				Conditions:  makeTestConditions("c", "a", "b"),
				Realms: []*protocol.Realm{
					{
						Name: "proj2:@root",
						Bindings: []*protocol.Binding{
							{
								Permissions: []uint32{0},
								// Condition c.
								Conditions: []uint32{0},
								Principals: []string{"group:gr2"},
							},
							{
								Permissions: []uint32{0},
								// Condition a.
								Conditions: []uint32{1},
								Principals: []string{"group:gr3"},
							},
							{
								Permissions: []uint32{0},
								// Conditions c, a, b.
								Conditions: []uint32{0, 1, 2},
								Principals: []string{"group:gr4"},
							},
						},
					},
				},
			}
			blob2, err := ToStorableRealms(proj2Realms)
			So(err, ShouldBeNil)
			projectRealms := []*AuthProjectRealms{
				{ID: "proj1", Realms: blob1},
				{ID: "proj2", Realms: blob2},
			}

			merged, err := MergeRealms(ctx, realmsGlobals, projectRealms, false)
			So(err, ShouldBeNil)
			So(merged, ShouldResembleProto, &protocol.Realms{
				ApiVersion:  RealmsAPIVersion,
				Permissions: makeTestPermissions("luci.dev.p1"),
				Conditions:  makeTestConditions("a", "b", "c"),
				Realms: []*protocol.Realm{
					{
						Name: "proj1:@root",
						Bindings: []*protocol.Binding{
							{
								Permissions: []uint32{0},
								Conditions:  []uint32{0, 1},
								Principals:  []string{"group:gr1"},
							},
						},
					},
					{
						Name: "proj2:@root",
						Bindings: []*protocol.Binding{
							{
								Permissions: []uint32{0},
								// Condition a.
								Conditions: []uint32{0},
								Principals: []string{"group:gr3"},
							},
							{
								Permissions: []uint32{0},
								// Conditions a, b, c.
								Conditions: []uint32{0, 1, 2},
								Principals: []string{"group:gr4"},
							},
							{
								Permissions: []uint32{0},
								// Condition c.
								Conditions: []uint32{2},
								Principals: []string{"group:gr2"},
							},
						},
					},
				},
			})
		})

		Convey("permissions across multiple projects are remapped", func() {
			realmsGlobals := &AuthRealmsGlobals{
				PermissionsList: &permissions.PermissionsList{
					Permissions: makeTestPermissions("luci.dev.p1", "luci.dev.p2", "luci.dev.p3"),
				},
			}

			// Set up project realms.
			proj1Realms := &protocol.Realms{
				Permissions: makeTestPermissions("luci.dev.p1", "luci.dev.p2"),
				Realms: []*protocol.Realm{
					{
						Name: "proj1:@root",
						Bindings: []*protocol.Binding{
							{
								// Permissions p1 and p2.
								Permissions: []uint32{0, 1},
								Principals:  []string{"group:gr1"},
							},
						},
						Data: &protocol.RealmData{
							EnforceInService: []string{"a"},
						},
					},
				},
			}
			blob1, err := ToStorableRealms(proj1Realms)
			So(err, ShouldBeNil)
			proj2Realms := &protocol.Realms{
				Permissions: makeTestPermissions("luci.dev.p2", "luci.dev.p3"),
				Realms: []*protocol.Realm{
					{
						Name: "proj2:@root",
						Bindings: []*protocol.Binding{
							{
								// Permissions p2 and p3.
								Permissions: []uint32{0, 1},
								Principals:  []string{"group:gr2"},
							},
						},
					},
				},
			}
			blob2, err := ToStorableRealms(proj2Realms)
			So(err, ShouldBeNil)
			projectRealms := []*AuthProjectRealms{
				{ID: "proj1", Realms: blob1},
				{ID: "proj2", Realms: blob2},
			}

			merged, err := MergeRealms(ctx, realmsGlobals, projectRealms, false)
			So(err, ShouldBeNil)
			So(merged, ShouldResembleProto, &protocol.Realms{
				ApiVersion:  RealmsAPIVersion,
				Permissions: makeTestPermissions("luci.dev.p1", "luci.dev.p2", "luci.dev.p3"),
				Realms: []*protocol.Realm{
					{
						Name: "proj1:@root",
						Bindings: []*protocol.Binding{
							{
								// Permissions p1 and p2.
								Permissions: []uint32{0, 1},
								Principals:  []string{"group:gr1"},
							},
						},
						Data: &protocol.RealmData{
							EnforceInService: []string{"a"},
						},
					},
					{
						Name: "proj2:@root",
						Bindings: []*protocol.Binding{
							{
								// Permissions p2 and p3.
								Permissions: []uint32{1, 2},
								Principals:  []string{"group:gr2"},
							},
						},
					},
				},
			})
		})

		Convey("Realm name should have matching project ID prefix", func() {
			realmsGlobals := &AuthRealmsGlobals{
				PermissionsList: &permissions.PermissionsList{
					Permissions: makeTestPermissions("luci.dev.p1"),
				},
			}
			proj1Realms := &protocol.Realms{
				Permissions: makeTestPermissions("luci.dev.p1"),
				Realms: []*protocol.Realm{
					{
						Name: "proj2:@root",
					},
				},
			}
			blob, err := ToStorableRealms(proj1Realms)
			So(err, ShouldBeNil)
			projectRealms := []*AuthProjectRealms{
				{ID: "proj1", Realms: blob},
			}

			merged, err := MergeRealms(ctx, realmsGlobals, projectRealms, false)
			So(err, ShouldNotBeNil)
			So(merged, ShouldBeNil)
		})
	})
}
