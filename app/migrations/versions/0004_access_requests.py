"""access requests: people who asked to join from the sign-in page

Revision ID: 0004_access_requests
Revises: 0003_agent_tasks
Create Date: 2026-11-23 22:30:00
"""
from alembic import op
import sqlalchemy as sa


revision = '0004_access_requests'
down_revision = '0003_agent_tasks'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table('access_requests',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('firm_id', sa.Integer(), nullable=False),
    sa.Column('email', sa.String(length=254), nullable=False),
    sa.Column('name', sa.String(length=200), nullable=False),
    sa.Column('enrolment_no', sa.String(length=60), nullable=True),
    sa.Column('message', sa.String(length=500), nullable=False),
    sa.Column('password_hash', sa.String(length=300), nullable=False),
    sa.Column('status', sa.String(length=20), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.Column('decided_at', sa.DateTime(), nullable=True),
    sa.Column('decided_by', sa.Integer(), nullable=True),
    sa.ForeignKeyConstraint(['firm_id'], ['firms.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('access_requests', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_access_requests_firm_id'), ['firm_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_access_requests_email'), ['email'], unique=False)


def downgrade() -> None:
    with op.batch_alter_table('access_requests', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_access_requests_email'))
        batch_op.drop_index(batch_op.f('ix_access_requests_firm_id'))
    op.drop_table('access_requests')
