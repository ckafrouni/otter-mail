import Foundation
import Testing
@testable import Otter_Mail

struct MailSwipeTests {
    @Test func aShortFlickRevealsButNeverCommits() {
        #expect(MailSwipeTarget.resolve(offset: -30, velocity: -1800, width: 400, actionCount: 2) == .revealed(-152))
        #expect(MailSwipeTarget.resolve(offset: 30, velocity: 1800, width: 400, actionCount: 1) == .revealed(76))
    }

    @Test func fullSwipeCommitsOnlyWhenNotReversing() {
        #expect(MailSwipeTarget.resolve(offset: -300, velocity: 0, width: 400, actionCount: 2) == .committed)
        #expect(MailSwipeTarget.resolve(offset: 300, velocity: 0, width: 400, actionCount: 1) == .committed)
        #expect(MailSwipeTarget.resolve(offset: -300, velocity: 500, width: 400, actionCount: 2) == .revealed(-152))
    }

    @Test func closingAndUnavailableActionsDoNotCommit() {
        #expect(MailSwipeTarget.resolve(offset: -100, velocity: 1000, width: 400, actionCount: 2) == .closed)
        #expect(MailSwipeTarget.resolve(offset: 10, velocity: 0, width: 400, actionCount: 1) == .closed)
        #expect(MailSwipeTarget.resolve(offset: -300, velocity: 0, width: 400, actionCount: 0) == .closed)
        #expect(MailSwipeTarget.resolve(offset: -300, velocity: 0, width: 0, actionCount: 2) == .closed)
    }
}
