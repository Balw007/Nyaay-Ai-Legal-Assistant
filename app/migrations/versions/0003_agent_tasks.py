"""agent tasks: background AI work with recorded steps

Revision ID: 0003_agent_tasks
Revises: 0002_gold_entries
Create Date: 2026-11-23 20:30:00
"""
from alembic import op
import sqlalchemy as sa


revision = '0003_agent_tasks'
down_revision = '0002_gold_entries'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table('agent_tasks',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('firm_id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=True),
    sa.Column('user_name', sa.String(length=200), nullable=False),
    sa.Column('agent', sa.String(length=30), nullable=False),
    sa.Column('title', sa.String(length=300), nullable=False),
    sa.Column('input', sa.JSON(), nullable=False),
    sa.Column('matter_id', sa.Integer(), nullable=True),
    sa.Column('status', sa.String(length=20), nullable=False),
    sa.Column('progress', sa.Integer(), nullable=False),
    sa.Column('indeterminate', sa.Boolean(), nullable=False),
    sa.Column('step', sa.String(length=300), nullable=False),
    sa.Column('steps', sa.JSON(), nullable=False),
    sa.Column('result', sa.JSON(), nullable=True),
    sa.Column('error', sa.Text(), nullable=False),
    sa.Column('cancel_requested', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.Column('started_at', sa.DateTime(), nullable=True),
    sa.Column('finished_at', sa.DateTime(), nullable=True),
    sa.ForeignKeyConstraint(['firm_id'], ['firms.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('agent_tasks', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_agent_tasks_firm_id'), ['firm_id'], unique=False)


def downgrade() -> None:
    with op.batch_alter_table('agent_tasks', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_agent_tasks_firm_id'))
    op.drop_table('agent_tasks')
