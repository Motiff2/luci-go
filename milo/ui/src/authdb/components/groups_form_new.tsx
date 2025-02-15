// Copyright 2024 The LUCI Authors.
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
import { createTheme, ThemeProvider } from '@mui/material/styles';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { FormControl } from '@mui/material';
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { AuthGroup, CreateGroupRequest } from '@/proto/go.chromium.org/luci/auth_service/api/rpcpb/groups.pb';
import { useAuthServiceClient } from '@/authdb/hooks/prpc_clients';
import { addPrefixToItems, isGlob, nameRe, isMember, isSubgroup } from '@/authdb/common/helpers';

const theme = createTheme({
  typography: {
    h6: {
      color: 'black',
    },
  },
  components: {
    MuiTableCell: {
      styleOverrides: {
        root: {
          borderBottom: 'none',
        }
      }
    },
  },
});

export function GroupsFormNew() {
  const [name, setName] = useState<string>('');
  const [nameErrorMessage, setNameErrorMessage] = useState<string>('');
  const [description, setDescription] = useState<string>('');
  const [descriptionErrorMessage, setDescriptionErrorMessage] = useState<string>('');
  const [owners, setOwners] = useState<string>('');
  const [ownersErrorMessage, setOwnersErrorMessage] = useState<string>('');
  const [members, setMembers] = useState<string>('');
  const [membersErrorMessage, setMembersErrorMessage] = useState<string>('');
  const [globs, setGlobs] = useState<string>('');
  const [globsErrorMessage, setGlobsErrorMessage] = useState<string>('');
  const [subgroups, setSubgroups] = useState<string>('');
  const [subgroupsErrorMessage, setSubgroupsErrorMessage] = useState<string>('');
  const [successCreatedGroup, setSuccessCreatedGroup] = useState<boolean>();
  const [errorMessage, setErrorMessage] = useState<string>();

  const client = useAuthServiceClient();
  const createMutation = useMutation({
    mutationFn: (request: CreateGroupRequest) => {
      return client.CreateGroup(request);
    },
    onSuccess: () => {
      setErrorMessage('');
      setSuccessCreatedGroup(true);
    },
    onError: () => {
      setSuccessCreatedGroup(false);
      setErrorMessage('Error creating group');
    },
    onSettled: () => {
    }
  })

  const createGroup = () => {
    if (!nameRe.test(name)) {
      setNameErrorMessage('Invalid group name.');
    } else {
      setNameErrorMessage('');
    }
    if (!description) {
      setDescriptionErrorMessage('Description is required.');
    } else {
      setDescriptionErrorMessage('');
    }
    if (!nameRe.test(owners)) {
      setOwnersErrorMessage('Invalid owners name. Must be a group.');
    } else {
      setOwnersErrorMessage('');
    }
    let membersArray = members.split(/[\n ]+/).filter((item) => item !== "");
    let invalidMembers = membersArray.filter((member) => !(isMember(member)));
    if (invalidMembers.length > 0) {
      let errorMessage = 'Invalid members: ' + invalidMembers.join(', ');
      setMembersErrorMessage(errorMessage);
    } else {
      setMembersErrorMessage('');
    }
    let globsArray = globs.split(/[\n ]+/).filter((item) => item !== "");
    let invalidGlobs = globsArray.filter((glob) => !isGlob(glob));
    if (invalidGlobs.length > 0) {
      let errorMessage = 'Invalid globs: ' + invalidGlobs.join(', ');
      setGlobsErrorMessage(errorMessage);
    } else {
      setGlobsErrorMessage('');
    }
    let subgroupsArray = subgroups.split(/[\n ]+/).filter((item) => item !== "");
    let invalidSubgroups = subgroupsArray.filter((subgroup) => !isSubgroup(subgroup));
    if (invalidSubgroups.length > 0) {
      let errorMessage = 'Invalid subgroups: ' + invalidSubgroups.join(', ');
      setSubgroupsErrorMessage(errorMessage);
    } else {
      setSubgroupsErrorMessage('');
    }
    if (!nameErrorMessage && !descriptionErrorMessage && !ownersErrorMessage && !membersErrorMessage && !globsErrorMessage && !subgroupsErrorMessage) {
      submitForm(membersArray, globsArray, subgroupsArray);
    }
  }

  const submitForm = (membersArray: string[], globsArray: string[], subgroupsArray: string[]) => {
    const members = membersArray ? addPrefixToItems('user', membersArray) : [];
    const subgroups = subgroupsArray || [];
    const globs = globsArray ? addPrefixToItems('user', globsArray) : [];
    const newGroup = AuthGroup.fromPartial({
      "name": name,
      "description": description,
      "owners": owners,
      "nested": subgroups,
      "members": members,
      "globs": globs,
    });
    createMutation.mutate({ 'group': newGroup });
  }

  return (
    <Box sx={{ minHeight: '500px', p: '20px', ml: '5px' }}>
      <ThemeProvider theme={theme}>
        <FormControl data-testid="groups-form-new" style={{ width: '100%' }}>
          <Typography variant="h5" sx={{ pl: 1.5 }}> Creating New Group </Typography>
          <TableContainer sx={{ p: 0, width: '100%' }} >
            <Table>
              <TableBody>
                <TableRow>
                  <TableCell sx={{ pb: 0 }} style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', minHeight: '45px' }}>
                    <Typography variant="h6"> Name</Typography>
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell align='left' style={{ width: '95%' }} sx={{ pt: 0, pb: '8px' }}>
                    <TextField value={name} style={{ width: '100%' }} onChange={(e) => setName(e.target.value)} id='nameTextfield' data-testid='name-textfield' placeholder='required' error={nameErrorMessage !== ""} helperText={nameErrorMessage}></TextField>
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell sx={{ pb: 0 }} style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', minHeight: '45px' }}>
                    <Typography variant="h6"> Description</Typography>
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell align='left' style={{ width: '95%' }} sx={{ pt: 0, pb: '8px' }}>
                    <TextField value={description} style={{ width: '100%', minHeight: '60px' }} onChange={(e) => setDescription(e.target.value)} id='descriptionTextfield' data-testid='description-textfield' placeholder='required' error={descriptionErrorMessage !== ""} helperText={descriptionErrorMessage}></TextField>
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell sx={{ pb: 0 }} style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', minHeight: '45px' }}>
                    <Typography variant="h6"> Owners</Typography>
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell align='left' style={{ width: '95%' }} sx={{ pt: 0, pb: '8px' }}>
                    <TextField value={owners} style={{ width: '100%', minHeight: '60px' }} onChange={(e) => setOwners(e.target.value)} id='ownersTextfield' data-testid='owners-textfield' placeholder='administrators' error={ownersErrorMessage !== ""} helperText={ownersErrorMessage}></TextField>
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell sx={{ pb: 0 }} style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', minHeight: '45px' }}>
                    <Typography variant="h6"> Members</Typography>
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell align='left' style={{ width: '95%' }} sx={{ pt: 0, pb: '8px' }}>
                    <TextField multiline value={members} style={{ width: '100%', minHeight: '60px' }} onChange={(e) => setMembers(e.target.value)} id='membersTextfield' data-testid='members-textfield' error={membersErrorMessage !== ""} helperText={membersErrorMessage}></TextField>
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell sx={{ pb: 0 }} style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', minHeight: '45px' }}>
                    <Typography variant="h6"> Globs</Typography>
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell align='left' style={{ width: '95%' }} sx={{ pt: 0, pb: '8px' }}>
                    <TextField multiline value={globs} style={{ width: '100%', minHeight: '60px' }} onChange={(e) => setGlobs(e.target.value)} id='globsTextfield' data-testid='globs-textfield' error={globsErrorMessage !== ""} helperText={globsErrorMessage}></TextField>
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell sx={{ pb: 0 }} style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', minHeight: '45px' }}>
                    <Typography variant="h6"> Subgroups</Typography>
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell align='left' style={{ width: '95%' }} sx={{ pt: 0, pb: '8px' }}>
                    <TextField multiline value={subgroups} style={{ width: '100%', minHeight: '60px' }} onChange={(e) => setSubgroups(e.target.value)} id='subgroupsTextfield' data-testid='subgroups-textfield' error={subgroupsErrorMessage !== ""} helperText={subgroupsErrorMessage}></TextField>
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </TableContainer>
          <Button variant="contained" disableElevation style={{ width: '150px' }} sx={{ mt: 1.5, ml: '16px' }} onClick={createGroup} data-testid='create-button'>
            Create Group
          </Button>
          <div style={{ padding: '5px' }}>
            {successCreatedGroup &&
              <Alert severity="success">Group created</Alert>
            }
            {errorMessage &&
              <Alert severity="error">{errorMessage}</Alert>
            }
          </div>
        </FormControl>
      </ThemeProvider>
    </Box>
  );
}