const workflowMiddleware = require('../util/workflow')
const sendmail = require('../util/sendmail')
const path = require('path')
const sendVerificationEmail = require('../email/verification.js')
const submitWelcomeEmail = require('../email/welcome.js')
const errors = require('../../util/errors')

const duplicateCheck = async function(req, email, username) {
    const user = await req.app.db.models.User.findOne({
        $or: [{ username }, { email }]
    })

    if (user) {
        return false
    }

    return true
}

const createUser = async function(req, email, username, displayName, avatar, provider, providerId) {
    const fieldsToSet = {
        isActive: 'yes',
        username,
        email,
        search: [
            username,
            email,
        ],
        displayName,
        avatar,
        [provider]: { id: providerId }
    };

    const user = await req.app.db.models.User.create(fieldsToSet)
    return user
}

const createAccount = async function(req, user) {
    const fieldsToSet = {
        isVerified: 'yes',
        user: {
            id: user._id,
            name: user.username
        },
    };

    const account = await req.app.db.models.Account.create(fieldsToSet)

    return account
}

const sendWelcomeEmail = async function(req, res, email, username) {
    return new Promise((resolve, reject) => {
        submitWelcomeEmail(req, res, {
            username,
            email,
            onSuccess: function() {
                resolve()
            },
            onError: function(err) {
                console.error('Error Sending Welcome Email: '+ err);
                resolve()
                // return next(err);
            }
        })
    })
}

const logUserIn = async function(req, res, user) {
    return new Promise((resolve, reject) => {
        req.login(user, function(err) {
            if (err) {
                reject(err)
            }

            res.redirect(req.app.config.appUrl);
            resolve()
        });
    })
}

const completeSocialSignup = async function(req, res, next, email, username, displayName, avatar, provider, providerId) {
    const noDuplicate = await duplicateCheck(req, email, username)

    if (!noDuplicate) {
        return next({
            type: errors.VALIDATION_ERROR, // validation
            errFor: {
                email: `Your ${provider} email is already being used by another user.`
            }
        })
    }

    let user = await createUser(req, email, username, displayName, avatar, provider, providerId)
    const account = await createAccount(req, user)

    user.roles.account = account._id;
    user = await user.save()

    if (req.app.config.sendWelcomeEmail) {
        sendWelcomeEmail(req, res, email, username)
    }

    if (req.app.config.onSignup ) {
        req.app.config.onSignup(user, account)
    }


    return logUserIn(req, res, user)
}

exports.signupTwitter = function signupTwitter(req, res, next) {
    req._passport.instance.authenticate('twitter', function(err, user, info) {

        if (!info || !info.profile) {
            return next({
                type: errors.SOCIAL_AUTH_FAILED, // validation
                provider: 'twitter',
            })
        }

        req.app.db.models.User.findOne({ 'twitter.id': info.profile.id }, function(err, user) {
            if (err) {
                return next(err);
            }

            if (!user) {
                const providerId = info.profile.id
                const email = info.profile.emails && info.profile.emails[0].value
                const avatar = !info.profile._json.default_profile_image && info.profile._json.profile_image_url_https
                const displayName = info.profile.displayName
                return completeSocialSignup(req, res, next, email, email, displayName, avatar, 'twitter', providerId)
                    .catch(next)
            }
            else {
                return logUserIn(req, res, user)
                    .catch(next)
            }
        });
    })(req, res, next);
}

exports.signupGoogle = function signupGoogle(req, res, next) {
    req._passport.instance.authenticate('google', function(err, user, info) {
        if (!info || !info.profile) {
            return next({
                type: errors.SOCIAL_AUTH_FAILED, // validation
                provider: 'google',
            })
        }

        req.app.db.models.User.findOne({ 'google.id': info.profile.id }, function(err, user) {
            if (err) {
                return next(err);
            }
            if (!user) {
                const providerId = info.profile.id
                const email = info.profile.emails && info.profile.emails[0].value
                const avatar = !info.profile._json.image.isDefault && info.profile._json.image.url
                const displayName = info.profile.displayName
                return completeSocialSignup(req, res, next, email, email, displayName, avatar, 'google', providerId)
                    .catch(next)
            }
            else {
                return logUserIn(req, res, user)
                    .catch(next)
            }
        });
    })(req, res, next);
};

exports.signupGithub = function signupGithub(req, res, next) {
    req._passport.instance.authenticate('github', function(err, user, info) {
        if (!info || !info.profile) {
            return next({
                type: errors.SOCIAL_AUTH_FAILED, // validation
                provider: 'github',
            })
        }


        req.app.db.models.User.findOne({ 'github.id': info.profile.id }, function(err, user) {
            if (err) {
                return next(err);
            }

            if (!user) {
                const providerId = info.profile.id
                const email = info.profile.emails && info.profile.emails[0].value
                const avatar = info.profile._json.avatar_url
                const displayName = info.profile.displayName
                return completeSocialSignup(req, res, next, email, email, displayName, avatar, 'github', providerId)
                    .catch(next)
            }
            else {
                return logUserIn(req, res, user)
                    .catch(next)
            }
        });
    })(req, res, next);
};

exports.signupFacebook = function signupFacebook(req, res, next) {
    req._passport.instance.authenticate('facebook', function(err, user, info) {
        if (!info || !info.profile) {
            return next({
                type: errors.SOCIAL_AUTH_FAILED, // validation
                provider: 'facebook',
            })
        }

        req.app.db.models.User.findOne({ 'facebook.id': info.profile.id }, function(err, user) {
            if (err) {
                return next(err);
            }
            if (!user) {
                const providerId = info.profile.id
                const email = info.profile.emails && info.profile.emails[0].value
                const avatar = !info.profile._json.picture.data.is_silhouette && info.profile._json.picture.data.url
                const displayName = info.profile.displayName
                return completeSocialSignup(req, res, next, email, email, displayName, avatar, 'facebook', providerId)
                    .catch(next)
            }
            else {
                return logUserIn(req, res, user)
                    .catch(next)
            }
        });
    })(req, res, next);
};
