'use strict';

const mongoose = require('mongoose')

const startWorkflow = require('../auth/util/workflow')
const sendmail = require('../auth/util/sendmail')
const slugify = require('../auth/util/slugify')

exports.find = function(req, res, next){
    // TODO: this one seems off - 2017-05-01
    var outcome = {};

//     var getStatusOptions = function(callback) {
//         req.app.db.models.Status.find({ pivot: 'Account' }, 'name').sort('name').exec(function(err, statuses) {
//             if (err) {
//                 return callback(err, null);
//             }

//             outcome.statuses = statuses;
//             return callback(null, 'done');
//         });
//     };

    var getResults = function(callback) {
        req.query.search = req.query.search ? req.query.search : '';
        req.query.status = req.query.status ? req.query.status : '';
        req.query.limit = req.query.limit ? parseInt(req.query.limit, null) : 20;
        req.query.page = req.query.page ? parseInt(req.query.page, null) : 1;
        req.query.sort = req.query.sort ? req.query.sort : '_id';

        var filters = {};
        if (req.query.search) {
            filters.search = new RegExp('^.*?'+ req.query.search +'.*$', 'i');
        }
        if (req.query.username) {
            filters['user.name'] = new RegExp('^.*?' + req.query.username + '.*$', 'i');
        }
        if (req.query.status) {
            filters['status.id'] = req.query.status;
        }

        req.app.db.models.Account.pagedFind({
            filters: filters,
            keys: 'name company phone zip userCreated status',
            limit: req.query.limit,
            page: req.query.page,
            sort: req.query.sort
        }, function(err, results) {
            if (err) {
                return callback(err, null);
            }

            outcome.results = results;
            return callback(null, 'done');
        });
    };

    getResults(function(err, nvt) {
        if (err) {
            return next(err);
        }

        res.header('Cache-Control', 'no-cache, no-store, must-revalidate');
        outcome.results.filters = req.query;
        res.send(outcome.results);
    })

    // var asyncFinally = function(err, results) {
    //     if (err) {
    //         return next(err);
    //     }

    //     res.header('Cache-Control', 'no-cache, no-store, must-revalidate');
    //     outcome.results.filters = req.query;
    //     res.send(outcome.results);
    // };

    // require('async').parallel([getResults], asyncFinally);
};

exports.read = function(req, res, next){
    var outcome = {};

    var getStatusOptions = function(callback) {
        req.app.db.models.Status.find({ pivot: 'Account' }, 'name').sort('name').exec(function(err, statuses) {
            if (err) {
                return callback(err, null);
            }

            outcome.statuses = statuses;
            return callback(null, 'done');
        });
    };

    var getRecord = function(callback) {
        req.app.db.models.Account.findById(req.params.id).exec(function(err, record) {
            if (err) {
                return callback(err, null);
            }

            outcome.record = record;
            return callback(null, 'done');
        });
    };

    var asyncFinally = function(err, results) {
        if (err) {
            return next(err);
        }

        res.send(outcome.record);
    };

    require('async').parallel([getStatusOptions, getRecord], asyncFinally);
};

exports.create = function(req, res, next){
    var workflow = startWorkflow(req, res);

    workflow.on('validate', function() {
        if (!req.body['name']) {
            workflow.outcome.errors.push('Please enter a name.');
            return workflow.emit('response');
        }

        workflow.emit('createAccount');
    });

    workflow.on('createAccount', function() {
        var nameParts = req.body['name'].trim().split(/\s/);
        var fieldsToSet = {
            name: {
                first: nameParts.shift(),
                middle: (nameParts.length > 1 ? nameParts.shift() : ''),
                last: (nameParts.length === 0 ? '' : nameParts.join(' ')),
            },
            userCreated: {
                id: req.user._id,
                name: req.user.username,
                time: new Date().toISOString()
            }
        };
        fieldsToSet.name.full = fieldsToSet.name.first + (fieldsToSet.name.last ? ' '+ fieldsToSet.name.last : '');
        fieldsToSet.search = [
            fieldsToSet.name.first,
            fieldsToSet.name.middle,
            fieldsToSet.name.last
        ];

        req.app.db.models.Account.create(fieldsToSet, function(err, account) {
            if (err) {
                return workflow.emit('exception', err);
            }

            workflow.outcome.record = account;
            return workflow.emit('response');
        });
    });

    workflow.emit('validate');
};

exports.update = function(req, res, next){
    var workflow = startWorkflow(req, res);

    workflow.on('validate', function() {
        if (!req.body.name) {
            workflow.outcome.errfor.name = 'required';
        }

        if (!req.body.name.first) {
            if (!workflow.outcome.errfor.name) {
                workflow.outcome.errfor.name = {}
            }
            workflow.outcome.errfor.name.first = 'required';
        }

        if (!req.body.name.last) {
            if (!workflow.outcome.errfor.name) {
                workflow.outcome.errfor.name = {}
            }
            workflow.outcome.errfor.name.last = 'required';
        }

        if (workflow.hasErrors()) {
            return workflow.emit('response');
        }

        workflow.emit('patchAccount');
    });

    workflow.on('patchAccount', function() {
        var fieldsToSet = {
            name: {
                first: req.body.name.first,
                middle: req.body.name.middle,
                last: req.body.name.last,
                full: req.body.name.first +' '+ req.body.name.last
            },
            company: req.body.company,
            phone: req.body.phone,
            zip: req.body.zip,
            search: [
                req.body.name.first,
                req.body.name.middle,
                req.body.name.last,
                req.body.company,
                req.body.phone,
                req.body.zip
            ]
        };
        var options = { new: true };
        req.app.db.models.Account.findByIdAndUpdate(req.params.id, fieldsToSet, options, function(err, account) {
            if (err) {
                return workflow.emit('exception', err);
            }

            workflow.outcome.account = account;
            return workflow.emit('response');
        });
    });

    workflow.emit('validate');
};

exports.linkUser = function(req, res, next){
    var workflow = startWorkflow(req, res);

    workflow.on('validate', function() {
        if (!req.user.roles.admin.isMemberOf('root')) {
            workflow.outcome.errors.push('You may not link accounts to users.');
            return workflow.emit('response');
        }

        if (!req.body.username) {
            workflow.outcome.errfor.username = 'required';
            return workflow.emit('response');
        }

        workflow.emit('verifyUser');
    });

    workflow.on('verifyUser', function(callback) {
        req.app.db.models.User.findOne({ username: req.body.username }).exec(function(err, user) {
            if (err) {
                return workflow.emit('exception', err);
            }

            if (!user) {
                workflow.outcome.errors.push('User not found.');
                return workflow.emit('response');
            }
            else if (user.roles && user.roles.account && user.roles.account !== req.params.id) {
                workflow.outcome.errors.push('User is already linked to a different account.');
                return workflow.emit('response');
            }

            workflow.user = user;
            workflow.emit('duplicateLinkCheck');
        });
    });

    workflow.on('duplicateLinkCheck', function(callback) {
        req.app.db.models.Account.findOne({ 'user.id': workflow.user._id, _id: {$ne: req.params.id} }).exec(function(err, account) {
            if (err) {
                return workflow.emit('exception', err);
            }

            if (account) {
                workflow.outcome.errors.push('Another account is already linked to that user.');
                return workflow.emit('response');
            }

            workflow.emit('patchUser');
        });
    });

    workflow.on('patchUser', function() {
        var fieldsToSet = {
            'roles.account': req.params.id
        };
        var options = { new: true };
        req.app.db.models.User.findByIdAndUpdate(workflow.user._id, fieldsToSet, options, function(err, user) {
            if (err) {
                return workflow.emit('exception', err);
            }

            workflow.emit('patchAccount');
        });
    });

    workflow.on('patchAccount', function(callback) {
        var fieldsToSet = {
            user: {
                id: workflow.user._id,
                name: workflow.user.username
            }
        };
        var options = { new: true };
        req.app.db.models.Account.findByIdAndUpdate(req.params.id, fieldsToSet, options, function(err, account) {
            if (err) {
                return workflow.emit('exception', err);
            }

            workflow.outcome.account = account;
            workflow.emit('response');
        });
    });

    workflow.emit('validate');
};

exports.unlinkUser = function(req, res, next){
    var workflow = startWorkflow(req, res);

    workflow.on('validate', function() {
        if (!req.user.roles.admin.isMemberOf('root')) {
            workflow.outcome.errors.push('You may not unlink users from accounts.');
            return workflow.emit('response');
        }

        workflow.emit('patchAccount');
    });

    workflow.on('patchAccount', function() {
        req.app.db.models.Account.findById(req.params.id).exec(function(err, account) {
            if (err) {
                return workflow.emit('exception', err);
            }

            if (!account) {
                workflow.outcome.errors.push('Account was not found.');
                return workflow.emit('response');
            }

            var userId = account.user.id;
            account.user = { id: undefined, name: '' };
            account.save(function(err, account) {
                if (err) {
                    return workflow.emit('exception', err);
                }

                workflow.outcome.account = account;
                workflow.emit('patchUser', userId);
            });
        });
    });

    workflow.on('patchUser', function(id) {
        req.app.db.models.User.findById(id).exec(function(err, user) {
            if (err) {
                return workflow.emit('exception', err);
            }

            if (!user) {
                workflow.outcome.errors.push('User was not found.');
                return workflow.emit('response');
            }

            user.roles.account = undefined;
            user.save(function(err, user) {
                if (err) {
                    return workflow.emit('exception', err);
                }

                workflow.emit('response');
            });
        });
    });

    workflow.emit('validate');
};

exports.newNote = function(req, res, next){
    var workflow = startWorkflow(req, res);

    workflow.on('validate', function() {
        if (!req.body.data) {
            workflow.outcome.errors.push('Data is required.');
            return workflow.emit('response');
        }

        workflow.emit('addNote');
    });

    workflow.on('addNote', function() {
        var fieldsToSet = {
            $push: {
                notes: {
                    // TODO: time seems to be renamed to timeCreated - 2017-05-01
                    data: req.body.data,
                    userCreated: {
                        id: req.user._id,
                        name: req.user.username,
                        time: new Date().toISOString()
                    }
                }
            }
        };
        var options = { new: true };
        req.app.db.models.Account.findByIdAndUpdate(req.params.id, fieldsToSet, options, function(err, account) {
            if (err) {
                return workflow.emit('exception', err);
            }

            workflow.outcome.account = account;
            return workflow.emit('response');
        });
    });

    workflow.emit('validate');
};

exports.newStatus = function(req, res, next){
    var workflow = startWorkflow(req, res);

    workflow.on('validate', function() {
        if (!req.body.status || !req.body.status.id) {
            workflow.outcome.errors.push('Please choose a status.');
        }

        if (workflow.hasErrors()) {
            return workflow.emit('response');
        }

        workflow.emit('addStatus');
    });

    workflow.on('addStatus', function() {
        // TODO: time seems to be renamed to timeCreated - 2017-05-01
        var statusToAdd = {
            id: req.body.status.id,
            name: req.body.status.name,
            userCreated: {
                id: req.user._id,
                name: req.user.username,
                time: new Date().toISOString()
            }
        };
        var fieldsToSet = {
            // TODO: this seems to be renamed to status.current and status.log - 2017-05-01
            status: statusToAdd,
            $push: {
                statusLog: statusToAdd
            }
        };
        var options = { new: true };
        req.app.db.models.Account.findByIdAndUpdate(req.params.id, fieldsToSet, options, function(err, account) {
            if (err) {
                return workflow.emit('exception', err);
            }

            workflow.outcome.account = account;
            return workflow.emit('response');
        });
    });

    workflow.emit('validate');
};

exports.delete = function(req, res, next){
    var workflow = startWorkflow(req, res);

    workflow.on('validate', function() {
        if (!req.user.roles.admin.isMemberOf('root')) {
            workflow.outcome.errors.push('You may not delete accounts.');
            return workflow.emit('response');
        }

        workflow.emit('deleteAccount');
    });

    workflow.on('deleteAccount', function(err) {
        req.app.db.models.Account.findByIdAndRemove(req.params.id, function(err, account) {
            if (err) {
                return workflow.emit('exception', err);
            }

            workflow.outcome.account = account;
            workflow.emit('response');
        });
    });

    workflow.emit('validate');
};